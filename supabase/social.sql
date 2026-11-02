-- Pushup Battle social: run once in Supabase > SQL Editor (after economy.sql).
-- Bio, follows, likes/dislikes, and public battle history.

-- 1. Bio (players can edit their own, max 160 characters)
alter table public.profiles add column if not exists bio text check (char_length(bio) <= 160);
grant update (username, avatar_url, bio) on public.profiles to authenticated;

-- 2. Follows
create table if not exists public.follows (
  follower uuid not null references public.profiles(id) on delete cascade,
  followee uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists follows_followee_idx on public.follows (followee);
alter table public.follows enable row level security;
drop policy if exists "Follows are public" on public.follows;
create policy "Follows are public" on public.follows for select using (true);
drop policy if exists "Follow as yourself" on public.follows;
create policy "Follow as yourself" on public.follows for insert with check (auth.uid() = follower);
drop policy if exists "Unfollow as yourself" on public.follows;
create policy "Unfollow as yourself" on public.follows for delete using (auth.uid() = follower);

-- 3. Likes and dislikes (one vote per player per profile: 1 = like, -1 = dislike)
create table if not exists public.profile_votes (
  voter uuid not null references public.profiles(id) on delete cascade,
  target uuid not null references public.profiles(id) on delete cascade,
  vote smallint not null check (vote in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (voter, target),
  check (voter <> target)
);
create index if not exists profile_votes_target_idx on public.profile_votes (target);
alter table public.profile_votes enable row level security;
drop policy if exists "Votes are public" on public.profile_votes;
create policy "Votes are public" on public.profile_votes for select using (true);
drop policy if exists "Vote as yourself" on public.profile_votes;
create policy "Vote as yourself" on public.profile_votes for insert with check (auth.uid() = voter);
drop policy if exists "Change your vote" on public.profile_votes;
create policy "Change your vote" on public.profile_votes for update using (auth.uid() = voter) with check (auth.uid() = voter);
drop policy if exists "Remove your vote" on public.profile_votes;
create policy "Remove your vote" on public.profile_votes for delete using (auth.uid() = voter);

-- 4. Battle history is public, so anyone can see a player's last battles on their profile.
--    (Rows are tiny, about 200 bytes: the free tier holds millions.)
drop policy if exists "Players see their own matches" on public.matches;
drop policy if exists "Battle history is public" on public.matches;
create policy "Battle history is public" on public.matches for select using (true);
create index if not exists matches_a_idx on public.matches (player_a, started_at desc);
create index if not exists matches_b_idx on public.matches (player_b, started_at desc);
