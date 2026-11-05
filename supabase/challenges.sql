-- Pushup Battle scheduled challenges + throne motto: run once in Supabase > SQL Editor
-- (after economy.sql, social.sql and pushups.sql).
--
-- A challenge is a battle booked for a set time:
--   * The sender picks the mode and time (needs at least 4 Respect, nothing is taken yet).
--   * The other player can accept, decline, or change the mode/time and send it back.
--     Whoever didn't make the latest offer is the one who answers.
--   * Only when it's accepted do both players put down 4 Respect.
--   * Each offer can carry a note of up to 30 characters. Harmful notes can be reported (challenge_reports).
--   * You can't book two battles within 30 minutes of each other.
-- Safe to run again: it gives back stakes taken by the older version for challenges not yet accepted.
--   * From 10 minutes before until 15 minutes after the time, both players check in and battle.
--   * Afterwards: both showed up = both get their 4 back. Only one showed up = that player gets all 8.
--     Nobody showed up = the 8 go to a random recent battle winner as a "bonus from community respect".
-- All Respect moves happen here on the server.

-- 1. Challenges
create table if not exists public.challenges (
  id bigint generated always as identity primary key,
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('brawl', 'classic', 'rank')),
  at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'settled')),
  proposer uuid not null, -- who made the latest offer; the other player answers
  from_paid boolean not null default false,
  to_paid boolean not null default false,
  from_in timestamptz, -- check-in times
  to_in timestamptz,
  outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_user <> to_user)
);
create index if not exists challenges_from_idx on public.challenges (from_user, status);
create index if not exists challenges_to_idx on public.challenges (to_user, status);
alter table public.challenges enable row level security;
drop policy if exists "Players see their own challenges" on public.challenges;
create policy "Players see their own challenges" on public.challenges for select using (auth.uid() in (from_user, to_user));
-- no insert/update policies: only the functions below write here

-- a short note (up to 30 characters) that goes with the latest offer
alter table public.challenges add column if not exists note text check (char_length(note) <= 30);
alter table public.challenges add column if not exists bot_countered boolean not null default false;

-- Reported notes. Only you (the owner) read these, in Table Editor > challenge_reports.
create table if not exists public.challenge_reports (
  id bigint generated always as identity primary key,
  challenge_id bigint not null references public.challenges(id) on delete cascade,
  reporter uuid not null references public.profiles(id) on delete cascade,
  author uuid not null references public.profiles(id) on delete cascade, -- who wrote the note
  note text not null,
  created_at timestamptz not null default now(),
  unique (challenge_id, reporter, note)
);
alter table public.challenge_reports enable row level security;

create or replace function public._clean_note(p_note text)
returns text
as $fn$
  select nullif(left(regexp_replace(btrim(coalesce(p_note, '')), '\s+', ' ', 'g'), 30), '')
$fn$ language sql immutable;

-- Another open challenge of mine within 30 minutes of this time? Returns the other player's name.
create or replace function public._challenge_clash(p_me uuid, p_at timestamptz, p_skip bigint, p_accepted_only boolean default false)
returns text
as $fn$
  select p.username from public.challenges c
    join public.profiles p on p.id = case when c.from_user = p_me then c.to_user else c.from_user end
   where p_me in (c.from_user, c.to_user) and c.id <> coalesce(p_skip, -1)
     and (c.status = 'accepted' or (not p_accepted_only and c.status = 'pending'))
     and abs(extract(epoch from c.at - p_at)) < 1800
   order by abs(extract(epoch from c.at - p_at)) limit 1
$fn$ language sql stable security definer set search_path = public;

create or replace function public._check_challenge_slot(p_mode text, p_at timestamptz)
returns void
as $fn$
begin
  if p_mode not in ('brawl', 'classic', 'rank') then raise exception 'Unknown battle mode'; end if;
  if p_at < now() + interval '2 minutes' then raise exception 'Pick a time at least a few minutes from now'; end if;
  if p_at > now() + interval '14 days' then raise exception 'Pick a time within the next 2 weeks'; end if;
end;
$fn$ language plpgsql;

-- Send a challenge (nothing is taken until it's accepted), with an optional short note
drop function if exists public.send_challenge(uuid, text, timestamptz);
create or replace function public.send_challenge(p_to uuid, p_mode text, p_at timestamptz, p_note text default null)
returns bigint
as $fn$
declare
  me uuid := auth.uid();
  bal integer;
  cid bigint;
  clash text;
begin
  if me is null then raise exception 'Please sign in again'; end if;
  if p_to = me then raise exception 'You cannot challenge yourself'; end if;
  perform public._check_challenge_slot(p_mode, p_at);
  if (select count(*) from public.challenges where from_user = me and status in ('pending', 'accepted')) >= 10 then
    raise exception 'You already have 10 open challenges';
  end if;
  select respect into bal from public.profiles where id = me;
  if bal < 4 then raise exception 'You need 4 Respect to send a challenge'; end if;
  clash := public._challenge_clash(me, p_at, null);
  if clash is not null then raise exception 'You already booked a battle with % around then. Pick a time at least 30 minutes away.', clash; end if;
  insert into public.challenges (from_user, to_user, mode, at, proposer, note)
  values (me, p_to, p_mode, p_at, me, public._clean_note(p_note)) returning id into cid;
  return cid;
end;
$fn$ language plpgsql security definer set search_path = public;

create or replace function public._refund_challenge(c public.challenges)
returns void
as $fn$
begin
  if c.from_paid then perform public._add_respect(c.from_user, 4, 'challenge refund', null); end if;
  if c.to_paid then perform public._add_respect(c.to_user, 4, 'challenge refund', null); end if;
end;
$fn$ language plpgsql security definer set search_path = public;

-- Answer a challenge: 'accept', 'decline', or 'counter' (send it back with a new mode and/or time and a note;
-- then the one who sent it is the one who answers)
drop function if exists public.respond_challenge(bigint, text, text, timestamptz);
create or replace function public.respond_challenge(p_id bigint, p_action text, p_mode text default null, p_at timestamptz default null, p_note text default null)
returns void
as $fn$
declare
  me uuid := auth.uid();
  c public.challenges;
  clash text;
begin
  select * into c from public.challenges where id = p_id for update;
  if c.id is null or me not in (c.from_user, c.to_user) then raise exception 'This is not your challenge'; end if;
  if c.status <> 'pending' then raise exception 'This challenge is already %', c.status; end if;
  if c.at < now() then raise exception 'This challenge time has passed'; end if;
  if me = c.proposer then raise exception 'Waiting for the other player to answer'; end if;

  if p_action = 'decline' then
    perform public._refund_challenge(c);
    update public.challenges set status = 'declined', updated_at = now() where id = p_id;
  elsif p_action = 'counter' then
    perform public._check_challenge_slot(coalesce(p_mode, c.mode), coalesce(p_at, c.at));
    clash := public._challenge_clash(me, coalesce(p_at, c.at), p_id);
    if clash is not null then raise exception 'You already booked a battle with % around then. Pick a time at least 30 minutes away.', clash; end if;
    update public.challenges set mode = coalesce(p_mode, c.mode), at = coalesce(p_at, c.at), proposer = me,
      note = public._clean_note(p_note), updated_at = now() where id = p_id;
  elsif p_action = 'accept' then
    -- now both players put down their 4 Respect
    perform 1 from public.profiles where id in (c.from_user, c.to_user) for update;
    if (select respect from public.profiles where id = me) < 4 then raise exception 'You need 4 Respect to accept'; end if;
    clash := public._challenge_clash(me, c.at, p_id, true);
    if clash is not null then raise exception 'You already have a battle with % around then. Send this one back with another time.', clash; end if;
    if (select respect from public.profiles where id = case when me = c.from_user then c.to_user else c.from_user end) < 4 then
      raise exception 'The other player doesn''t have 4 Respect right now';
    end if;
    if not c.from_paid then perform public._add_respect(c.from_user, -4, 'challenge stake', null); end if;
    if not c.to_paid then perform public._add_respect(c.to_user, -4, 'challenge stake', null); end if;
    update public.challenges set from_paid = true, to_paid = true where id = p_id;
    update public.challenges set status = 'accepted', updated_at = now() where id = p_id;
  else
    raise exception 'Unknown answer';
  end if;
end;
$fn$ language plpgsql security definer set search_path = public;

-- Either player can call off a challenge that hasn't been accepted yet (stakes come back).
create or replace function public.cancel_challenge(p_id bigint)
returns void
as $fn$
declare c public.challenges;
begin
  select * into c from public.challenges where id = p_id for update;
  if c.id is null or auth.uid() not in (c.from_user, c.to_user) then raise exception 'This is not your challenge'; end if;
  if c.status <> 'pending' then raise exception 'An accepted challenge can''t be called off. Show up!'; end if;
  perform public._refund_challenge(c);
  update public.challenges set status = 'cancelled', updated_at = now() where id = p_id;
end;
$fn$ language plpgsql security definer set search_path = public;

-- "I'm here": from 10 minutes before until 15 minutes after the time.
create or replace function public.check_in_challenge(p_id bigint)
returns void
as $fn$
declare c public.challenges;
begin
  select * into c from public.challenges where id = p_id for update;
  if c.id is null or auth.uid() not in (c.from_user, c.to_user) then raise exception 'This is not your challenge'; end if;
  if c.status <> 'accepted' then raise exception 'This challenge is not on'; end if;
  if now() < c.at - interval '10 minutes' then raise exception 'Too early. Check in from 10 minutes before.'; end if;
  if now() > c.at + interval '15 minutes' then raise exception 'Too late, the challenge is over'; end if;
  if auth.uid() = c.from_user then update public.challenges set from_in = coalesce(from_in, now()) where id = p_id;
  else update public.challenges set to_in = coalesce(to_in, now()) where id = p_id; end if;
end;
$fn$ language plpgsql security definer set search_path = public;

create or replace function public._settle_challenge(p_id bigint)
returns void
as $fn$
declare
  c public.challenges;
  lucky uuid;
begin
  select * into c from public.challenges where id = p_id for update;
  if c.id is null then return; end if;
  -- an offer nobody answered in time: give the stakes back
  if c.status = 'pending' and now() > c.at then
    perform public._refund_challenge(c);
    update public.challenges set status = 'cancelled', outcome = 'expired', updated_at = now() where id = p_id;
    return;
  end if;
  if c.status <> 'accepted' or now() <= c.at + interval '15 minutes' then return; end if;

  if c.from_in is not null and c.to_in is not null then
    perform public._refund_challenge(c);
    update public.challenges set outcome = 'both' where id = p_id;
  elsif c.from_in is not null then
    perform public._add_respect(c.from_user, 8, 'challenge: opponent didn''t show', null);
    update public.challenges set outcome = 'from' where id = p_id;
  elsif c.to_in is not null then
    perform public._add_respect(c.to_user, 8, 'challenge: opponent didn''t show', null);
    update public.challenges set outcome = 'to' where id = p_id;
  else
    select winner into lucky from public.matches
     where winner is not null and winner not in (c.from_user, c.to_user) and settled_at > now() - interval '7 days'
     order by random() limit 1;
    if lucky is not null then perform public._add_respect(lucky, 8, 'bonus from community respect', null); end if;
    update public.challenges set outcome = 'none' where id = p_id;
  end if;
  update public.challenges set status = 'settled', updated_at = now() where id = p_id;
end;
$fn$ language plpgsql security definer set search_path = public;

-- Settles my challenges that are over. Called when the app opens.
create or replace function public.settle_my_challenges()
returns void
as $fn$
declare r record;
begin
  for r in select id from public.challenges
           where auth.uid() in (from_user, to_user)
             and ((status = 'pending' and now() > at) or (status = 'accepted' and now() > at + interval '15 minutes'))
  loop
    perform public._settle_challenge(r.id);
  end loop;
end;
$fn$ language plpgsql security definer set search_path = public;

-- Report a note that's harmful. The note is copied so it stays even if it's changed later.
create or replace function public.report_challenge_note(p_id bigint)
returns void
as $fn$
declare c public.challenges;
begin
  select * into c from public.challenges where id = p_id;
  if c.id is null or auth.uid() not in (c.from_user, c.to_user) then raise exception 'This is not your challenge'; end if;
  if c.note is null then raise exception 'There is no note to report'; end if;
  if c.proposer = auth.uid() then raise exception 'That''s your own note'; end if;
  insert into public.challenge_reports (challenge_id, reporter, author, note)
  values (c.id, auth.uid(), c.proposer, c.note) on conflict do nothing;
end;
$fn$ language plpgsql security definer set search_path = public;

revoke all on function public._refund_challenge(public.challenges) from public, anon, authenticated;
revoke all on function public._challenge_clash(uuid, timestamptz, bigint, boolean) from public, anon, authenticated;
revoke all on function public._settle_challenge(bigint) from public, anon, authenticated;

-- 2. Throne motto: the player on the throne can write a line shown on the throne (80 characters).
alter table public.profiles add column if not exists throne_motto text check (char_length(throne_motto) <= 80);
grant update (username, avatar_url, bio, throne_motto) on public.profiles to authenticated;

-- 3. Give back stakes the older version took before a challenge was accepted
do $mig$
declare c public.challenges;
begin
  for c in select * from public.challenges where status = 'pending' and (from_paid or to_paid) for update loop
    perform public._refund_challenge(c);
    update public.challenges set from_paid = false, to_paid = false where id = c.id;
  end loop;
end;
$mig$;
