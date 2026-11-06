-- Pushup Battle dev pins: run once in Supabase > SQL Editor.
-- The developer account drops pins in the open world with a note ("stair floats here", "too dark").
-- Only that account can see, add or delete them. Nobody else can read the table.

create table if not exists public.world_pins (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  world text not null default 'arasaka',
  x real not null, y real not null, z real not null,
  yaw real not null default 0, pitch real not null default 0,
  note text not null,
  done boolean not null default false
);

alter table public.world_pins enable row level security;

drop policy if exists "dev pins" on public.world_pins;
create policy "dev pins" on public.world_pins
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'huidromdiamond123@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'huidromdiamond123@gmail.com');
