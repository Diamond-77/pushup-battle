-- Pushup Battle: show players' names in Supabase > Authentication > Users. Run once in the SQL Editor.
--
-- Google accounts bring their name with them; accounts made with an email (like the bots) don't,
-- so their "Display name" is blank there. This copies each player's in-game name into those blank
-- spots, and keeps it in step when a player changes their name. Names from Google are left alone.

create or replace function public._sync_display_name(p_id uuid, p_name text)
returns void
as $fn$
  update auth.users u
     set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
       || jsonb_build_object('display_name', p_name, 'full_name', p_name, 'name', p_name, 'name_from_game', 'true')
   where u.id = p_id and p_name is not null and p_name <> ''
     and (coalesce(u.raw_user_meta_data->>'full_name', '') = '' or u.raw_user_meta_data->>'name_from_game' = 'true')
$fn$ language sql security definer set search_path = public, auth;
revoke all on function public._sync_display_name(uuid, text) from public, anon, authenticated;

create or replace function public._profile_name_sync()
returns trigger
as $fn$
begin
  perform public._sync_display_name(new.id, new.username);
  return new;
end;
$fn$ language plpgsql security definer set search_path = public, auth;

drop trigger if exists profiles_name_sync on public.profiles;
create trigger profiles_name_sync after insert or update of username on public.profiles
  for each row execute function public._profile_name_sync();

-- fill in everyone who already has a name in the game
select public._sync_display_name(id, username) from public.profiles;
