-- Pushup Battle titles: run once in Supabase > SQL Editor.
-- Adds a title and a "legendary" flag to profiles. Players can still change their own
-- name and picture, but only the database owner (you, in this editor) can give titles.

alter table public.profiles add column if not exists title text;
alter table public.profiles add column if not exists legendary boolean not null default false;

-- Players may only write their own name and picture, never title or legendary.
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, username, avatar_url) on public.profiles to authenticated;
grant update (username, avatar_url) on public.profiles to authenticated;

-- Give a player a title (replace the email):
-- update public.profiles set title = 'Developer', legendary = true
-- where id = (select id from auth.users where email = 'someone@example.com');
