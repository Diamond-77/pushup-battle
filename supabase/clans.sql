-- Pushup Battle clans: run this once in Supabase > SQL Editor (after schema.sql).
-- Players join one clan for 30 days. Joining goes through join_clan(), so nobody can
-- fake their dates or switch clans early.

create table if not exists public.clans (
  id text primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into public.clans (id, name) values
  ('arasaka', 'Arasaka'),
  ('soraran-gate', 'Soraran Gate'),
  ('sleepbuilders', 'sleepBuilders')
on conflict (id) do update set name = excluded.name;

alter table public.clans enable row level security;
drop policy if exists "Clans are readable by everyone" on public.clans;
create policy "Clans are readable by everyone" on public.clans for select using (true);

-- One row per player. An expired row means the player is a lone warrior again.
create table if not exists public.clan_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  clan_id text not null references public.clans(id),
  joined_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

alter table public.clan_members enable row level security;
drop policy if exists "Memberships are readable by everyone" on public.clan_members;
create policy "Memberships are readable by everyone" on public.clan_members for select using (true);
-- No insert/update policies on purpose: players can only join through join_clan().

create or replace function public.join_clan(p_clan text)
returns public.clan_members
as $fn$
declare
  m public.clan_members;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  select * into m from public.clan_members where user_id = auth.uid();
  if found and m.expires_at > now() then
    raise exception 'You are already in a clan until %', to_char(m.expires_at, 'Mon DD');
  end if;
  insert into public.clan_members (user_id, clan_id, joined_at, expires_at)
  values (auth.uid(), p_clan, now(), now() + interval '30 days')
  on conflict (user_id) do update
    set clan_id = excluded.clan_id, joined_at = excluded.joined_at, expires_at = excluded.expires_at
  returning * into m;
  return m;
end;
$fn$ language plpgsql security definer set search_path = public;

revoke all on function public.join_clan(text) from public;
grant execute on function public.join_clan(text) to authenticated;
