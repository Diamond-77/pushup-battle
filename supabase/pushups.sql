-- Pushup Battle lifetime push-ups: run once in Supabase > SQL Editor (after economy.sql and social.sql).
-- Every push-up a player does in the app (training and battles) is added to one row per player per day.
-- That's about 365 tiny rows per player per year, so the free tier holds it easily.
-- Days follow India time (Asia/Kolkata). Change PB_TZ below if your players live elsewhere.

-- 1. One row per player per day
create table if not exists public.pushup_days (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  reps integer not null default 0 check (reps >= 0),
  primary key (user_id, day)
);
alter table public.pushup_days enable row level security;
drop policy if exists "Push-up days are public" on public.pushup_days;
create policy "Push-up days are public" on public.pushup_days for select using (true);
-- (no insert/update policies: only the functions below write here)

-- when each player last sent training reps (for the speed limit)
create table if not exists public.pushup_log_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_at timestamptz not null default now(),
  today date,
  today_reps integer not null default 0
);
alter table public.pushup_log_state enable row level security;

create or replace function public.pb_today() returns date
as $fn$ select (now() at time zone 'Asia/Kolkata')::date $fn$ -- PB_TZ
language sql stable;

create or replace function public._add_pushups(p_user uuid, p_day date, p_reps integer)
returns void
as $fn$
begin
  if p_reps is null or p_reps <= 0 then return; end if;
  insert into public.pushup_days (user_id, day, reps) values (p_user, p_day, p_reps)
  on conflict (user_id, day) do update set reps = public.pushup_days.reps + excluded.reps;
end;
$fn$ language plpgsql security definer set search_path = public;
revoke all on function public._add_pushups(uuid, date, integer) from public, anon, authenticated;

-- 2. Battles count automatically: when a player's reps are reported, they're added to their day.
create or replace function public._match_pushups()
returns trigger
as $fn$
declare d date := (new.started_at at time zone 'Asia/Kolkata')::date; -- PB_TZ
begin
  if old.a_reps is null and new.a_reps is not null then perform public._add_pushups(new.player_a, d, new.a_reps); end if;
  if old.b_reps is null and new.b_reps is not null then perform public._add_pushups(new.player_b, d, new.b_reps); end if;
  return new;
end;
$fn$ language plpgsql security definer set search_path = public;
revoke all on function public._match_pushups() from public, anon, authenticated;

-- 3. Training (challenges and free practice): the app sends its reps every few seconds.
--    Nobody does more than 1.5 push-ups a second, so a call can't add more than that since the last one,
--    and a day tops out at 3000.
create or replace function public.log_pushups(p_reps integer)
returns integer
as $fn$
declare
  me uuid := auth.uid();
  st public.pushup_log_state;
  d date := public.pb_today();
  allowed integer;
begin
  if me is null then raise exception 'Please sign in again'; end if;
  if p_reps is null or p_reps <= 0 then return 0; end if;
  insert into public.pushup_log_state (user_id, last_at, today, today_reps) values (me, now() - interval '200 seconds', d, 0)
  on conflict (user_id) do nothing;
  select * into st from public.pushup_log_state where user_id = me for update;
  if st.today is distinct from d then st.today_reps := 0; end if;
  allowed := least(p_reps, 300, greatest(3, floor(extract(epoch from now() - st.last_at) * 1.5)::integer), 3000 - st.today_reps);
  allowed := greatest(allowed, 0);
  update public.pushup_log_state set last_at = now(), today = d, today_reps = st.today_reps + allowed where user_id = me;
  perform public._add_pushups(me, d, allowed);
  return allowed;
end;
$fn$ language plpgsql security definer set search_path = public;

-- 4. Everything a profile card shows, in one call.
create or replace function public.player_card(p_user uuid)
returns json
as $fn$
  with days as (select day, reps from public.pushup_days where user_id = p_user),
  -- streak: consecutive active days ending today (or yesterday, if today isn't done yet)
  runs as (
    select day, day - (row_number() over (order by day))::integer as grp from days where reps > 0
  ),
  streaks as (select min(day) as first_day, max(day) as last_day, count(*)::integer as len from runs group by grp),
  me as (select respect from public.profiles where id = p_user),
  clan as (select clan_id from public.clan_members where user_id = p_user and expires_at > now())
  select json_build_object(
    'total', (select coalesce(sum(reps), 0) from days),
    'best_day', (select coalesce(max(reps), 0) from days),
    'active_days', (select count(*) from days where reps > 0),
    'streak', (select coalesce(max(len), 0) from streaks where last_day >= public.pb_today() - 1),
    'best_streak', (select coalesce(max(len), 0) from streaks),
    'today', public.pb_today(),
    'recent', (select coalesce(json_agg(json_build_object('day', day, 'reps', reps) order by day), '[]'::json)
               from days where day >= date_trunc('month', public.pb_today() - 40)::date),
    'wins', (select count(*) from public.matches where winner = p_user),
    'battles', (select count(*) from public.matches where settled_at is not null and a_paid and b_paid and p_user in (player_a, player_b)),
    'best_battle', (select coalesce(max(case when player_a = p_user then a_reps else b_reps end), 0)
                    from public.matches where p_user in (player_a, player_b)),
    'throne_rank', (select 1 + count(*) from public.profiles p, me where p.respect > me.respect),
    'clan_rank', (select 1 + count(*) from public.clan_members cm join public.profiles p on p.id = cm.user_id, me, clan
                  where cm.clan_id = clan.clan_id and cm.expires_at > now() and p.respect > me.respect),
    'clan_size', (select count(*) from public.clan_members cm, clan where cm.clan_id = clan.clan_id and cm.expires_at > now())
  )
$fn$ language sql stable security definer set search_path = public;

-- 5. Count the battles already played (safe to run again: days already filled are left alone).
insert into public.pushup_days (user_id, day, reps)
select u, d, sum(r)::integer from (
  select player_a as u, (started_at at time zone 'Asia/Kolkata')::date as d, a_reps as r from public.matches where a_reps > 0
  union all
  select player_b, (started_at at time zone 'Asia/Kolkata')::date, b_reps from public.matches where b_reps > 0
) x group by u, d
on conflict (user_id, day) do nothing;

drop trigger if exists match_pushups on public.matches;
create trigger match_pushups after update of a_reps, b_reps on public.matches
for each row execute function public._match_pushups();
