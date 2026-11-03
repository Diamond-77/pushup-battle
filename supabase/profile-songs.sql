-- Pushup Battle profile songs: run once in Supabase > SQL Editor.
-- Every player can put a song from their own phone or computer on their profile.
-- The file goes to the public "songs" storage bucket, in a folder named after the player's id.

alter table public.profiles add column if not exists song_url text
  check (song_url is null or song_url like 'https://%/storage/v1/object/public/songs/%');
alter table public.profiles add column if not exists song_title text check (char_length(song_title) <= 80);
alter table public.profiles add column if not exists song_artist text check (char_length(song_artist) <= 80);
alter table public.profiles add column if not exists song_start integer not null default 0 check (song_start between 0 and 3600);
grant update (song_url, song_title, song_artist, song_start) on public.profiles to authenticated;

-- songs bucket: public to listen, 15 MB max, audio files only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('songs', 'songs', true, 15728640, array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/m4a', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Songs are public" on storage.objects;
create policy "Songs are public" on storage.objects for select using (bucket_id = 'songs');
drop policy if exists "Players upload their own song" on storage.objects;
create policy "Players upload their own song" on storage.objects for insert to authenticated
  with check (bucket_id = 'songs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Players replace their own song" on storage.objects;
create policy "Players replace their own song" on storage.objects for update to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Players delete their own song" on storage.objects;
create policy "Players delete their own song" on storage.objects for delete to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = auth.uid()::text);
