-- Pushup Battle scheduled challenges + throne motto: run once in Supabase > SQL Editor
-- (after economy.sql, social.sql and pushups.sql).
--
-- A challenge is a battle booked for a set time:
--   * The sender picks the mode and time (needs at least 4 Respect, nothing is taken yet).
--   * The other player can accept, decline, or change the mode/time and send it back.
--     Whoever didn't make the latest offer is the one who answers.
--   * Only when it's accepted do both players put down 4 Respect.
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

create or replace function public._check_challenge_slot(p_mode text, p_at timestamptz)
returns void
as $fn$
begin
  if p_mode not in ('brawl', 'classic', 'rank') then raise exception 'Unknown battle mode'; end if;
  if p_at < now() + interval '2 minutes' then raise exception 'Pick a time at least a few minutes from now'; end if;
  if p_at > now() + interval '14 days' then raise exception 'Pick a time within the next 2 weeks'; end if;
end;
$fn$ language plpgsql;

-- Send a challenge (puts down 4 Respect)
create or replace function public.send_challenge(p_to uuid, p_mode text, p_at timestamptz)
returns bigint
as $fn$
declare
  me uuid := auth.uid();
  bal integer;
  cid bigint;
begin
  if me is null then raise exception 'Please sign in again'; end if;
  if p_to = me then raise exception 'You cannot challenge yourself'; end if;
  perform public._check_challenge_slot(p_mode, p_at);
  if (select count(*) from public.challenges where from_user = me and status in ('pending', 'accepted')) >= 10 then
    raise exception 'You already have 10 open challenges';
  end if;
  select respect into bal from public.profiles where id = me;
  if bal < 4 then raise exception 'You need 4 Respect to send a challenge'; end if;
  insert into public.challenges (from_user, to_user, mode, at, proposer)
  values (me, p_to, p_mode, p_at, me) returning id into cid;
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

-- Answer a challenge: 'accept', 'decline', or 'counter' (with a new mode and/or time)
create or replace function public.respond_challenge(p_id bigint, p_action text, p_mode text default null, p_at timestamptz default null)
returns void
as $fn$
declare
  me uuid := auth.uid();
  c public.challenges;
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
    update public.challenges set mode = coalesce(p_mode, c.mode), at = coalesce(p_at, c.at), proposer = me, updated_at = now() where id = p_id;
  elsif p_action = 'accept' then
    -- now both players put down their 4 Respect
    perform 1 from public.profiles where id in (c.from_user, c.to_user) for update;
    if (select respect from public.profiles where id = me) < 4 then raise exception 'You need 4 Respect to accept'; end if;
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

revoke all on function public._refund_challenge(public.challenges) from public, anon, authenticated;
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
