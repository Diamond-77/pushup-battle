-- Pushup Battle Respect economy: run once in Supabase > SQL Editor (after schema.sql, clans.sql, titles.sql).
-- Every Respect change happens here on the server, never in the app.
--   Brawl   1 min, bet 5   (fewer than 5 reps = lose 1 extra Respect)
--   Classic 3 min, bet 10
--   Rank    7 min, bet 100 (needs at least 120 Respect)
--   Training challenges refill Respect, but only up to 50.
-- Keep the numbers in sync with MODES and TRAINING in src/config.ts.

-- 1. Respect on every profile (new players start with 50). Players can't write it themselves:
--    titles.sql already limits their updates to username and avatar_url.
alter table public.profiles add column if not exists respect integer not null default 50 check (respect >= 0);
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, username, avatar_url) on public.profiles to authenticated;
grant update (username, avatar_url) on public.profiles to authenticated;
create index if not exists profiles_respect_idx on public.profiles (respect desc);

-- 2. History of every change
create table if not exists public.respect_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta integer not null,
  reason text not null,
  match_id uuid,
  created_at timestamptz not null default now()
);
alter table public.respect_log enable row level security;
drop policy if exists "Players see their own respect log" on public.respect_log;
create policy "Players see their own respect log" on public.respect_log for select using (auth.uid() = user_id);

-- 3. Matches (rows are only written by the functions below)
create table if not exists public.matches (
  id uuid primary key,
  mode text not null check (mode in ('brawl', 'classic', 'rank')),
  player_a uuid not null references public.profiles(id) on delete cascade,
  player_b uuid not null references public.profiles(id) on delete cascade,
  bet integer not null,
  a_paid boolean not null default false,
  b_paid boolean not null default false,
  a_reps integer,
  b_reps integer,
  started_at timestamptz not null default now(),
  settled_at timestamptz,
  winner uuid
);
alter table public.matches enable row level security;
drop policy if exists "Players see their own matches" on public.matches;
create policy "Players see their own matches" on public.matches for select using (auth.uid() in (player_a, player_b));

create or replace function public.mode_bet(p_mode text) returns integer
as $fn$ select case p_mode when 'brawl' then 5 when 'classic' then 10 when 'rank' then 100 end $fn$
language sql immutable;

create or replace function public.mode_seconds(p_mode text) returns integer
as $fn$ select case p_mode when 'brawl' then 60 when 'classic' then 180 when 'rank' then 420 end $fn$
language sql immutable;

create or replace function public._add_respect(p_user uuid, p_delta integer, p_reason text, p_match uuid)
returns void
as $fn$
begin
  if p_delta = 0 then return; end if;
  update public.profiles set respect = greatest(0, respect + p_delta) where id = p_user;
  insert into public.respect_log (user_id, delta, reason, match_id) values (p_user, p_delta, p_reason, p_match);
end;
$fn$ language plpgsql security definer set search_path = public;

-- Called by each player when the match opens: pays that player's bet.
create or replace function public.join_match(p_match uuid, p_mode text, p_opponent uuid)
returns void
as $fn$
declare
  me uuid := auth.uid();
  m public.matches;
  bal integer;
  bet integer := public.mode_bet(p_mode);
begin
  if me is null then raise exception 'Please sign in again'; end if;
  if bet is null then raise exception 'Unknown battle mode'; end if;
  if p_opponent = me then raise exception 'You cannot battle yourself'; end if;

  insert into public.matches (id, mode, player_a, player_b, bet)
  values (p_match, p_mode, least(me, p_opponent), greatest(me, p_opponent), bet)
  on conflict (id) do nothing;
  select * into m from public.matches where id = p_match for update;
  if me not in (m.player_a, m.player_b) or p_opponent not in (m.player_a, m.player_b) or m.mode <> p_mode then
    raise exception 'This is not your match';
  end if;
  if m.settled_at is not null then raise exception 'This match is already over'; end if;
  if (me = m.player_a and m.a_paid) or (me = m.player_b and m.b_paid) then return; end if;

  select respect into bal from public.profiles where id = me for update;
  if p_mode = 'rank' and bal < 120 then raise exception 'Rank needs at least 120 Respect'; end if;
  if bal < bet then raise exception 'You need % Respect for this mode. Train to earn it back.', bet; end if;

  perform public._add_respect(me, -bet, 'bet ' || p_mode, p_match);
  if me = m.player_a then update public.matches set a_paid = true where id = p_match;
  else update public.matches set b_paid = true where id = p_match; end if;
end;
$fn$ language plpgsql security definer set search_path = public;

-- Pays out a match. Waits for both reports, or until the match is long over
-- (a player who never reports counts as 0 reps: leaving a battle loses it).
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

-- Each player reports their own reps once when the match ends.
create or replace function public.report_match(p_match uuid, p_reps integer)
returns void
as $fn$
declare
  me uuid := auth.uid();
  m public.matches;
  reps integer;
begin
  select * into m from public.matches where id = p_match for update;
  if m.id is null or me not in (m.player_a, m.player_b) then raise exception 'This is not your match'; end if;
  if m.settled_at is not null then return; end if;
  -- nobody does more than 1.5 push-ups a second
  reps := least(greatest(coalesce(p_reps, 0), 0), floor(public.mode_seconds(m.mode) * 1.5)::integer);
  if me = m.player_a and m.a_reps is null then update public.matches set a_reps = reps where id = p_match; end if;
  if me = m.player_b and m.b_reps is null then update public.matches set b_reps = reps where id = p_match; end if;
  perform public._settle_match(p_match);
end;
$fn$ language plpgsql security definer set search_path = public;

-- Settles any of my matches that are long over (the opponent left). Called when the app opens.
create or replace function public.settle_my_matches()
returns void
as $fn$
declare r record;
begin
  for r in select id from public.matches
           where settled_at is null and auth.uid() in (player_a, player_b)
             and now() > started_at + make_interval(secs => public.mode_seconds(mode) + 90)
  loop
    perform public._settle_match(r.id);
  end loop;
end;
$fn$ language plpgsql security definer set search_path = public;

-- 4. Training challenges (refill Respect up to 50)
create table if not exists public.training_challenges (
  id text primary key,
  name text not null,
  reps integer not null,
  seconds integer not null,
  reward integer not null,
  sort integer not null default 0
);
alter table public.training_challenges enable row level security;
drop policy if exists "Training challenges are public" on public.training_challenges;
create policy "Training challenges are public" on public.training_challenges for select using (true);
insert into public.training_challenges (id, name, reps, seconds, reward, sort) values
  ('spark',    'Spark',        10,  30,  2, 1),
  ('ember',    'Ember',        20,  60,  4, 2),
  ('flame',    'Flame',        30,  90,  6, 3),
  ('blaze',    'Blaze',        50, 180, 10, 4),
  ('inferno',  'Inferno',     100, 420, 20, 5)
on conflict (id) do update set name = excluded.name, reps = excluded.reps, seconds = excluded.seconds, reward = excluded.reward, sort = excluded.sort;

create table if not exists public.training_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  challenge text not null references public.training_challenges(id),
  started_at timestamptz not null default now(),
  claimed_at timestamptz,
  reward integer
);
alter table public.training_runs enable row level security;
drop policy if exists "Players see their own training" on public.training_runs;
create policy "Players see their own training" on public.training_runs for select using (auth.uid() = user_id);

create or replace function public.start_training(p_challenge text)
returns bigint
as $fn$
declare run_id bigint;
begin
  if auth.uid() is null then raise exception 'Please sign in again'; end if;
  if not exists (select 1 from public.training_challenges where id = p_challenge) then raise exception 'Unknown challenge'; end if;
  delete from public.training_runs where user_id = auth.uid() and claimed_at is null; -- one open run at a time
  insert into public.training_runs (user_id, challenge) values (auth.uid(), p_challenge) returning id into run_id;
  return run_id;
end;
$fn$ language plpgsql security definer set search_path = public;

-- Returns the Respect earned (0 when already at 50).
create or replace function public.claim_training(p_run bigint, p_reps integer)
returns integer
as $fn$
declare
  r public.training_runs;
  c public.training_challenges;
  bal integer;
  gain integer;
  took numeric;
begin
  select * into r from public.training_runs where id = p_run and user_id = auth.uid() for update;
  if r.id is null or r.claimed_at is not null then raise exception 'This training run is over'; end if;
  select * into c from public.training_challenges where id = r.challenge;
  took := extract(epoch from now() - r.started_at);
  -- 3 s countdown + the challenge time + a little slack for slow networks
  if p_reps < c.reps or took > c.seconds + 20 or took < c.reps * 0.4 then
    raise exception 'Challenge not completed';
  end if;
  select respect into bal from public.profiles where id = auth.uid() for update;
  gain := greatest(0, least(c.reward, 50 - bal));
  perform public._add_respect(auth.uid(), gain, 'training ' || c.id, null);
  update public.training_runs set claimed_at = now(), reward = gain where id = p_run;
  return gain;
end;
$fn$ language plpgsql security definer set search_path = public;

-- Internal helpers can't be called from the app.
revoke all on function public._add_respect(uuid, integer, text, uuid) from public, anon, authenticated;
revoke all on function public._settle_match(uuid) from public, anon, authenticated;
