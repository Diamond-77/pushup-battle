-- Pushup Battle bots: run once in Supabase > SQL Editor (after economy.sql and pushups.sql).
--
-- Bots are normal accounts (you make them in Authentication > Users, then sign in once to pick
-- a name and picture). This file marks them as bots. When nobody else is searching, a player is
-- matched with a bot. The server decides how many push-ups the bot does, so nobody can fake it.
--
-- Tiers: weak, strong, boss. Testers (your own account) always get a bot quickly, of a set tier.

-- 1. Which accounts are bots (hidden: no one can read these tables from the app)
create table if not exists public.bot_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  tier text not null check (tier in ('weak', 'strong', 'boss'))
);
alter table public.bot_accounts enable row level security;

-- accounts that always get a bot match, and which tier
create table if not exists public.bot_testers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  tier text not null check (tier in ('weak', 'strong', 'boss'))
);
alter table public.bot_testers enable row level security;

-- the bot's count for each bot battle, kept here until the battle ends
create table if not exists public.bot_matches (
  match_id uuid primary key references public.matches(id) on delete cascade,
  bot_id uuid not null,
  total integer not null,
  seed integer not null
);
alter table public.bot_matches enable row level security;

-- 2. How many push-ups a bot does: per-minute pace that tires a little each minute, plus some luck.
create or replace function public._bot_total(p_tier text, p_mode text)
returns integer
as $fn$
declare
  pace numeric := case p_tier when 'weak' then 23 when 'strong' then 31 else 44 end; -- first minute
  mins integer := public.mode_seconds(p_mode) / 60;
  total numeric := 0;
  i integer;
begin
  for i in 0 .. mins - 1 loop
    total := total + pace * power(0.86, i);
  end loop;
  return greatest(3, round(total * (0.82 + random() * 0.33)))::integer; -- 82% to 115% of the pace
end;
$fn$ language plpgsql;

-- 3. Start a battle against a bot (called when nobody else is searching). Pays both bets.
create or replace function public.start_bot_match(p_mode text)
returns json
as $fn$
declare
  me uuid := auth.uid();
  bal integer;
  bet integer := public.mode_bet(p_mode);
  want text;
  bot record;
  mid uuid := gen_random_uuid();
  tot integer;
  sd integer := floor(random() * 2147483647)::integer;
begin
  if me is null then raise exception 'Please sign in again'; end if;
  if bet is null then raise exception 'Unknown battle mode'; end if;
  if exists (select 1 from public.bot_accounts where user_id = me) then raise exception 'Bots don''t search'; end if;
  select respect into bal from public.profiles where id = me for update;
  if p_mode = 'rank' and bal < 120 then raise exception 'Rank needs at least 120 Respect'; end if;
  if bal < bet then raise exception 'You need % Respect for this mode. Train to earn it back.', bet; end if;

  -- pick the tier: testers get theirs; others by mode and Respect, with a little surprise now and then
  select tier into want from public.bot_testers where user_id = me;
  if want is null then
    want := case when p_mode = 'rank' then 'boss' when bal < 80 then 'weak' when bal < 250 then 'strong' else 'boss' end;
    if random() < 0.25 then
      want := case want when 'weak' then 'strong' when 'boss' then 'strong' else (case when random() < 0.5 then 'weak' else 'boss' end) end;
    end if;
  end if;
  select b.user_id, p.username, p.avatar_url, p.legendary, p.title, p.respect into bot
    from public.bot_accounts b join public.profiles p on p.id = b.user_id
   order by (b.tier = want) desc, random() limit 1;
  if bot.user_id is null then raise exception 'No opponent found'; end if;

  -- the bot always has enough for its bet
  if bot.respect < bet then perform public._add_respect(bot.user_id, bet - bot.respect, 'refill', null); end if;
  insert into public.matches (id, mode, player_a, player_b, bet, a_paid, b_paid)
  values (mid, p_mode, least(me, bot.user_id), greatest(me, bot.user_id), bet, true, true);
  perform public._add_respect(me, -bet, 'bet ' || p_mode, mid);
  perform public._add_respect(bot.user_id, -bet, 'bet ' || p_mode, mid);
  tot := public._bot_total((select tier from public.bot_accounts where user_id = bot.user_id), p_mode);
  insert into public.bot_matches (match_id, bot_id, total, seed) values (mid, bot.user_id, tot, sd);

  return json_build_object('match_id', mid, 'total', tot, 'seed', sd,
    'opponent', json_build_object('id', bot.user_id, 'name', bot.username, 'avatar', bot.avatar_url, 'legendary', coalesce(bot.legendary, false), 'title', bot.title));
end;
$fn$ language plpgsql security definer set search_path = public;

-- the bot's count goes into the match once the player has reported, or the battle is long over
create or replace function public._fill_bot_reps(p_match uuid)
returns void
as $fn$
declare
  m public.matches;
  bm public.bot_matches;
  human_in boolean;
begin
  select * into m from public.matches where id = p_match for update;
  select * into bm from public.bot_matches where match_id = p_match;
  if m.id is null or bm.match_id is null then return; end if;
  human_in := case when bm.bot_id = m.player_a then m.b_reps is not null else m.a_reps is not null end;
  if not human_in and now() < m.started_at + make_interval(secs => public.mode_seconds(m.mode) + 90) then return; end if;
  if bm.bot_id = m.player_a and m.a_reps is null then update public.matches set a_reps = bm.total where id = p_match; end if;
  if bm.bot_id = m.player_b and m.b_reps is null then update public.matches set b_reps = bm.total where id = p_match; end if;
end;
$fn$ language plpgsql security definer set search_path = public;

-- 4. Settling now fills in the bot's count first (same as economy.sql otherwise)
create or replace function public._settle_match(p_match uuid)
returns void
as $fn$
declare
  m public.matches;
  a integer; b integer;
  a_low boolean; b_low boolean;
  win uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or m.settled_at is not null then return; end if;
  -- battle against a bot: its count goes in once the player has reported (or left)
  if exists (select 1 from public.bot_matches where match_id = m.id) then
    perform public._fill_bot_reps(m.id);
    select * into m from public.matches where id = p_match;
  end if;
  if (m.a_reps is null or m.b_reps is null)
     and now() < m.started_at + make_interval(secs => public.mode_seconds(m.mode) + 90) then
    return;
  end if;

  -- Only one side paid (the other never joined): refund, no battle.
  if not (m.a_paid and m.b_paid) then
    if m.a_paid then perform public._add_respect(m.player_a, m.bet, 'refund', m.id); end if;
    if m.b_paid then perform public._add_respect(m.player_b, m.bet, 'refund', m.id); end if;
    update public.matches set settled_at = now() where id = m.id;
    return;
  end if;

  a := coalesce(m.a_reps, 0);
  b := coalesce(m.b_reps, 0);
  win := case when a > b then m.player_a when b > a then m.player_b end;

  if m.mode = 'brawl' then
    a_low := a < 5;
    b_low := b < 5;
    if a_low then perform public._add_respect(m.player_a, -1, 'brawl under 5 reps', m.id); end if;
    if b_low then perform public._add_respect(m.player_b, -1, 'brawl under 5 reps', m.id); end if;
    if a_low and b_low then win := null;
    elsif a_low then win := m.player_b;
    elsif b_low then win := m.player_a; end if;
  end if;

  if win is null then
    perform public._add_respect(m.player_a, m.bet, 'draw refund', m.id);
    perform public._add_respect(m.player_b, m.bet, 'draw refund', m.id);
  else
    perform public._add_respect(win, m.bet * 2, 'won ' || m.mode, m.id);
  end if;
  update public.matches set settled_at = now(), winner = win where id = m.id;
end;
$fn$ language plpgsql security definer set search_path = public;


revoke all on function public._bot_total(text, text) from public, anon, authenticated;
revoke all on function public._fill_bot_reps(uuid) from public, anon, authenticated;
revoke all on function public._settle_match(uuid) from public, anon, authenticated;

-- 5. YOUR SIDE: put in the bot accounts' emails and your own, then run this part.
-- (Make each bot in Authentication > Users > Add user, then sign in as it once to pick its name and picture.)
insert into public.bot_accounts (user_id, tier)
select id, 'weak' from auth.users where email = 'WEAK_BOT_EMAIL'
on conflict (user_id) do update set tier = excluded.tier;
insert into public.bot_accounts (user_id, tier)
select id, 'strong' from auth.users where email = 'STRONG_BOT_EMAIL'
on conflict (user_id) do update set tier = excluded.tier;
insert into public.bot_accounts (user_id, tier)
select id, 'boss' from auth.users where email = 'BOSS_BOT_EMAIL'
on conflict (user_id) do update set tier = excluded.tier;
-- your account: always matched with a bot, the strong one
insert into public.bot_testers (user_id, tier)
select id, 'strong' from auth.users where email = 'YOUR_EMAIL'
on conflict (user_id) do update set tier = excluded.tier;
