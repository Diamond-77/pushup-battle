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
-- while you're signed in as a bot (e.g. changing its picture) it's "online" and won't be picked
alter table public.bot_accounts add column if not exists online_until timestamptz;

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
  pace numeric := case p_tier when 'weak' then 23 when 'strong' then 31 else 53 end; -- first minute
  mins integer := public.mode_seconds(p_mode) / 60;
  total numeric := 0;
  i integer;
begin
  for i in 0 .. mins - 1 loop
    total := total + pace * power(0.86, i);
  end loop;
  -- 82% to 115% of the pace; the boss has fewer off days (95% to 118%)
  if p_tier = 'boss' then return round(total * (0.95 + random() * 0.23))::integer; end if;
  return greatest(3, round(total * (0.82 + random() * 0.33)))::integer;
end;
$fn$ language plpgsql;

-- Bots train too: a bot under 50 Respect that hasn't won or lost anything for 4 hours trains back up to 50.
create or replace function public._bot_regen()
returns void
as $fn$
declare r record;
begin
  for r in select p.id, p.respect from public.bot_accounts b join public.profiles p on p.id = b.user_id
           where p.respect < 50
             and not exists (select 1 from public.respect_log l where l.user_id = p.id and l.created_at > now() - interval '4 hours')
  loop
    perform public._add_respect(r.id, 50 - r.respect, 'training', null);
  end loop;
  perform public._bot_life();
end;
$fn$ language plpgsql security definer set search_path = public;

-- Bot life: while nobody is watching, bots train and battle each other, so there's always
-- someone with enough Respect to fight (even in Rank). Every 20 minutes of real time:
--   * each free bot trains a little (same 50-a-day training cap as players),
--   * often, two free bots battle: real match rows, so they get a real history and push-up totals.
-- It catches up on missed time (up to 2 hours) the next time anyone opens the lobby.
create table if not exists public.bot_life (id integer primary key, last_run timestamptz not null);
alter table public.bot_life enable row level security;
insert into public.bot_life (id, last_run) values (1, now()) on conflict (id) do nothing;

create or replace function public._bot_free()
returns table (user_id uuid, tier text, respect integer)
as $fn$
  select b.user_id, b.tier, p.respect
  from public.bot_accounts b join public.profiles p on p.id = b.user_id
  where (b.online_until is null or b.online_until < now())
    and not exists (select 1 from public.matches x where x.settled_at is null and b.user_id in (x.player_a, x.player_b)
                    and x.started_at > now() - interval '10 minutes')
$fn$ language sql stable security definer set search_path = public;

create or replace function public._bot_life()
returns void
as $fn$
declare
  st timestamptz;
  slots integer;
  r record;
  a record;
  b record;
  md text;
  bet integer;
  ra integer;
  rb integer;
  mid uuid;
  earned integer;
  gain integer;
  win uuid;
begin
  select last_run into st from public.bot_life where id = 1 for update skip locked;
  if st is null then return; end if; -- someone else is running it right now
  slots := floor(extract(epoch from now() - st) / 1200)::integer;
  if slots < 1 then return; end if;
  update public.bot_life set last_run = case when slots > 6 then now() else st + make_interval(secs => slots * 1200) end where id = 1;
  slots := least(slots, 6);

  for i in 1..slots loop
    -- training
    for r in select * from public._bot_free() loop
      select coalesce(sum(delta), 0) into earned from public.respect_log
        where user_id = r.user_id and reason = 'training' and delta > 0 and created_at > now() - interval '24 hours';
      gain := least(50 - earned, case r.tier when 'weak' then 2 when 'strong' then 3 else 4 end);
      if gain > 0 then perform public._add_respect(r.user_id, gain, 'training', null); end if;
    end loop;

    -- a battle between two bots, most of the time
    continue when random() > 0.65;
    -- a bot sitting on 300+ rests, so one bot can't drain all the others
    select * into a from public._bot_free() f where f.respect between 5 and 299 order by random() limit 1;
    continue when a.user_id is null;
    select * into b from public._bot_free() f where f.respect between 5 and 299 and f.user_id <> a.user_id order by random() limit 1;
    continue when b.user_id is null;
    md := case
      when a.respect >= 120 and b.respect >= 120 and random() < 0.5 then 'rank'
      when a.respect >= 10 and b.respect >= 10 and random() < 0.6 then 'classic'
      else 'brawl' end;
    bet := public.mode_bet(md);
    ra := public._bot_total(a.tier, md);
    rb := public._bot_total(b.tier, md);
    mid := gen_random_uuid();
    insert into public.matches (id, mode, player_a, player_b, bet, a_paid, b_paid, started_at)
      values (mid, md, a.user_id, b.user_id, bet, true, true,
              now() - make_interval(secs => public.mode_seconds(md) + 30 + (random() * 900)::integer));
    perform public._add_respect(a.user_id, -bet, 'bet ' || md, mid);
    perform public._add_respect(b.user_id, -bet, 'bet ' || md, mid);
    win := case when ra > rb then a.user_id when rb > ra then b.user_id end;
    if win is null then
      perform public._add_respect(a.user_id, bet, 'draw refund', mid);
      perform public._add_respect(b.user_id, bet, 'draw refund', mid);
    else
      perform public._add_respect(win, bet * 2, 'won ' || md, mid);
    end if;
    -- reps go in with an update, so the push-up totals trigger counts them
    update public.matches set a_reps = ra, b_reps = rb, settled_at = now(), winner = win where id = mid;
  end loop;
end;
$fn$ language plpgsql security definer set search_path = public;
revoke all on function public._bot_life() from public, anon, authenticated;
revoke all on function public._bot_free() from public, anon, authenticated;

-- Makes the battle against a chosen bot: pays both bets and decides the bot's count.
create or replace function public._create_bot_match(p_me uuid, p_bot uuid, p_mode text)
returns json
as $fn$
declare
  bet integer := public.mode_bet(p_mode);
  bot record;
  mid uuid := gen_random_uuid();
  tot integer;
  sd integer := floor(random() * 2147483647)::integer;
begin
  select p.id, p.username, p.avatar_url, p.legendary, p.title, p.respect, b.tier into bot
    from public.bot_accounts b join public.profiles p on p.id = b.user_id where b.user_id = p_bot for update of p;
  if bot.id is null then raise exception 'not a bot'; end if;
  if (select respect from public.profiles where id = p_me) < bet then raise exception 'You need % Respect for this mode. Train to earn it back.', bet; end if;
  -- a bot that's out of Respect sits out until it has trained back (see _bot_regen)
  if bot.respect < bet then raise exception '% doesn''t have enough Respect right now', bot.username; end if;
  insert into public.matches (id, mode, player_a, player_b, bet, a_paid, b_paid)
  values (mid, p_mode, least(p_me, bot.id), greatest(p_me, bot.id), bet, true, true);
  perform public._add_respect(p_me, -bet, 'bet ' || p_mode, mid);
  perform public._add_respect(bot.id, -bet, 'bet ' || p_mode, mid);
  tot := public._bot_total(bot.tier, p_mode);
  insert into public.bot_matches (match_id, bot_id, total, seed) values (mid, bot.id, tot, sd);
  return json_build_object('match_id', mid, 'total', tot, 'seed', sd,
    'opponent', json_build_object('id', bot.id, 'name', bot.username, 'avatar', bot.avatar_url, 'legendary', coalesce(bot.legendary, false), 'title', bot.title));
end;
$fn$ language plpgsql security definer set search_path = public;

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
  perform public._bot_regen();
  -- skip bots you're signed in as, bots already in a battle (a real player can't be in two), and broke bots
  select b.user_id, p.username, p.avatar_url, p.legendary, p.title, p.respect into bot
    from public.bot_accounts b join public.profiles p on p.id = b.user_id
   where (b.online_until is null or b.online_until < now()) and p.respect >= bet
     and not exists (select 1 from public.matches x where x.settled_at is null and b.user_id in (x.player_a, x.player_b)
                     and x.started_at > now() - interval '10 minutes')
   order by (b.tier = want) desc, random() limit 1;
  if bot.user_id is null then raise exception 'No opponent found right now. Try again in a moment.'; end if;

  return public._create_bot_match(me, bot.user_id, p_mode);
end;
$fn$ language plpgsql security definer set search_path = public;

-- the app calls this every minute; it only does something when you're signed in as a bot
create or replace function public.bot_heartbeat()
returns void
as $fn$
  update public.bot_accounts set online_until = now() + interval '2 minutes' where user_id = auth.uid();
$fn$ language sql security definer set search_path = public;

-- the bot's count goes into the match once the player has reported, or the battle is long over.
-- A battle can end early by knockout (the tug-of-war bar reaching an end): then the bot's count is
-- what it had done by that moment, worked out here from the server clock.
create or replace function public._bot_count_at(p_total integer, p_mode text, p_secs numeric)
returns integer
as $fn$
declare d numeric := public.mode_seconds(p_mode);
begin
  if p_secs >= d then return p_total; end if;
  if p_secs <= 0 then return 0; end if;
  -- same tiring pace as _bot_total: share of the total done after p_secs
  return floor(p_total * (1 - power(0.86, p_secs / 60)) / (1 - power(0.86, d / 60)))::integer;
end;
$fn$ language plpgsql immutable;

create or replace function public._fill_bot_reps(p_match uuid)
returns void
as $fn$
declare
  m public.matches;
  bm public.bot_matches;
  human integer;
  secs numeric;
  at_now integer;
  ko integer;
  bot_reps integer;
begin
  select * into m from public.matches where id = p_match for update;
  select * into bm from public.bot_matches where match_id = p_match;
  if m.id is null or bm.match_id is null then return; end if;
  human := case when bm.bot_id = m.player_a then m.b_reps else m.a_reps end;
  if human is null and now() < m.started_at + make_interval(secs => public.mode_seconds(m.mode) + 90) then return; end if;
  if (case when bm.bot_id = m.player_a then m.a_reps else m.b_reps end) is not null then return; end if;

  bot_reps := bm.total;
  if human is not null then
    secs := extract(epoch from now() - m.started_at) - 5; -- about 5 s of "joined" + countdown before the bell
    if secs < public.mode_seconds(m.mode) - 2 then
      at_now := public._bot_count_at(bm.total, m.mode, secs);
      ko := ceil(50 / (case m.mode when 'brawl' then 5 when 'classic' then 2.5 else 1.5 end))::integer;
      -- a knockout either way stops the bot where it was; leaving early without one, the bot keeps going
      if abs(human - at_now) >= ko - 2 then bot_reps := at_now; end if;
    end if;
  end if;
  if bm.bot_id = m.player_a then update public.matches set a_reps = bot_reps where id = p_match;
  else update public.matches set b_reps = bot_reps where id = p_match; end if;
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


-- 4b. Bots take challenges too (needs challenges.sql).
-- A bot answers a challenge a few minutes after it arrives (like a person would), always says yes,
-- checks in when the time comes, and battles when you tap Start.
alter table public.challenges add column if not exists bot_match uuid;

create or replace function public._bot_accept(p_id bigint)
returns void
as $fn$
declare
  c public.challenges;
  human uuid;
  bot uuid;
begin
  select * into c from public.challenges where id = p_id for update;
  if c.status <> 'pending' then return; end if;
  bot := case when c.proposer = c.from_user then c.to_user else c.from_user end;
  human := c.proposer;
  perform 1 from public.profiles where id in (c.from_user, c.to_user) for update;
  if (select respect from public.profiles where id = human) < 4 then
    perform public._refund_challenge(c);
    update public.challenges set status = 'declined', updated_at = now() where id = p_id;
    return;
  end if;
  if (select respect from public.profiles where id = bot) < 4 then perform public._add_respect(bot, 4, 'refill', null); end if;
  if not c.from_paid then perform public._add_respect(c.from_user, -4, 'challenge stake', null); end if;
  if not c.to_paid then perform public._add_respect(c.to_user, -4, 'challenge stake', null); end if;
  update public.challenges set from_paid = true, to_paid = true, status = 'accepted', updated_at = now() where id = p_id;
end;
$fn$ language plpgsql security definer set search_path = public;

create or replace function public.settle_my_challenges()
returns void
as $fn$
declare r record;
begin
  -- bots answer: 1 to 12 minutes after the offer
  for r in select c.id from public.challenges c
           join public.bot_accounts b on b.user_id = case when c.proposer = c.from_user then c.to_user else c.from_user end
           where c.status = 'pending' and auth.uid() in (c.from_user, c.to_user) and c.at > now()
             and c.updated_at < now() - make_interval(mins => 1 + abs(hashtext(c.id::text || c.updated_at::text)) % 12)
  loop
    perform public._bot_accept(r.id);
  end loop;
  -- bots check in as soon as the check-in opens
  update public.challenges c set from_in = coalesce(c.from_in, c.at - interval '10 minutes' + make_interval(secs => abs(hashtext(c.id::text)) % 300))
   where c.status = 'accepted' and auth.uid() in (c.from_user, c.to_user) and now() >= c.at - interval '10 minutes'
     and exists (select 1 from public.bot_accounts b where b.user_id = c.from_user);
  update public.challenges c set to_in = coalesce(c.to_in, c.at - interval '10 minutes' + make_interval(secs => abs(hashtext(c.id::text)) % 300))
   where c.status = 'accepted' and auth.uid() in (c.from_user, c.to_user) and now() >= c.at - interval '10 minutes'
     and exists (select 1 from public.bot_accounts b where b.user_id = c.to_user);
  -- then settle as before
  for r in select id from public.challenges
           where auth.uid() in (from_user, to_user)
             and ((status = 'pending' and now() > at) or (status = 'accepted' and now() > at + interval '15 minutes'))
  loop
    perform public._settle_challenge(r.id);
  end loop;
end;
$fn$ language plpgsql security definer set search_path = public;

-- Start the battle of a challenge when the other side isn't in the lobby (works only if it's a bot).
create or replace function public.start_challenge_match(p_id bigint)
returns json
as $fn$
declare
  me uuid := auth.uid();
  c public.challenges;
  other uuid;
  res json;
begin
  select * into c from public.challenges where id = p_id for update;
  if c.id is null or me not in (c.from_user, c.to_user) then raise exception 'This is not your challenge'; end if;
  other := case when me = c.from_user then c.to_user else c.from_user end;
  if not exists (select 1 from public.bot_accounts where user_id = other) then raise exception 'waiting'; end if;
  if c.status <> 'accepted' or now() < c.at - interval '10 minutes' or now() > c.at + interval '15 minutes' then raise exception 'It''s not time yet'; end if;
  if c.bot_match is not null then raise exception 'You already battled this challenge'; end if;
  res := public._create_bot_match(me, other, c.mode);
  update public.challenges set bot_match = (res->>'match_id')::uuid,
    from_in = coalesce(from_in, now()), to_in = coalesce(to_in, now()) where id = p_id;
  return res;
end;
$fn$ language plpgsql security definer set search_path = public;
revoke all on function public._bot_accept(bigint) from public, anon, authenticated;
revoke all on function public._bot_regen() from public, anon, authenticated;
revoke all on function public._create_bot_match(uuid, uuid, text) from public, anon, authenticated;


-- 4c. Bots show up in the lobby's "online" list and can be challenged there.
create or replace function public.lobby_extras()
returns json
as $fn$
declare res json;
begin
  perform public._bot_regen();
  select coalesce(json_agg(json_build_object(
    'id', p.id, 'name', p.username, 'avatar', p.avatar_url, 'legendary', coalesce(p.legendary, false), 'title', p.title,
    'respect', p.respect,
    'clan', (select cm.clan_id from public.clan_members cm where cm.user_id = p.id and cm.expires_at > now() limit 1),
    'busy', p.respect < 5 or exists (select 1 from public.matches x where x.settled_at is null and p.id in (x.player_a, x.player_b) and x.started_at > now() - interval '10 minutes')
  )), '[]'::json)
  from public.bot_accounts b join public.profiles p on p.id = b.user_id
  where (b.online_until is null or b.online_until < now()) and auth.uid() is not null and auth.uid() <> b.user_id into res;
  return res;
end;
$fn$ language plpgsql security definer set search_path = public;

-- a live challenge to a bot in the lobby: it "accepts" and the battle starts
create or replace function public.start_bot_vs(p_bot uuid, p_mode text)
returns json
as $fn$
declare
  me uuid := auth.uid();
  bal integer;
begin
  if me is null then raise exception 'Please sign in again'; end if;
  if public.mode_bet(p_mode) is null then raise exception 'Unknown battle mode'; end if;
  perform public._bot_regen();
  if not exists (select 1 from public.bot_accounts where user_id = p_bot and (online_until is null or online_until < now())) then
    raise exception 'They went offline';
  end if;
  if exists (select 1 from public.matches x where x.settled_at is null and p_bot in (x.player_a, x.player_b) and x.started_at > now() - interval '10 minutes') then
    raise exception 'They''re in a battle right now';
  end if;
  select respect into bal from public.profiles where id = me for update;
  if p_mode = 'rank' and bal < 120 then raise exception 'Rank needs at least 120 Respect'; end if;
  return public._create_bot_match(me, p_bot, p_mode);
end;
$fn$ language plpgsql security definer set search_path = public;

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
