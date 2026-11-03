-- Pushup Battle: training pays up to 50 Respect per 24 hours, no matter how much Respect you have.
-- Run once in Supabase > SQL Editor (economy.sql must already be installed).

-- Returns the Respect earned (0 when today's 50 from training is used up).
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
  -- Training pays at most 50 Respect per 24 hours (rolling), on top of whatever you already have.
  select coalesce(sum(reward), 0) into bal from public.training_runs
   where user_id = auth.uid() and claimed_at > now() - interval '24 hours';
  gain := greatest(0, least(c.reward, 50 - bal));
  perform public._add_respect(auth.uid(), gain, 'training ' || c.id, null);
  update public.training_runs set claimed_at = now(), reward = gain where id = p_run;
  return gain;
end;
$fn$ language plpgsql security definer set search_path = public;

-- How much training Respect you've earned in the last 24 hours, and when the oldest of it frees up again.
create or replace function public.training_today()
returns table (earned integer, next_free timestamptz)
as $fn$
  select coalesce(sum(reward), 0)::integer, min(claimed_at) + interval '24 hours'
  from public.training_runs
  where user_id = auth.uid() and claimed_at > now() - interval '24 hours' and reward > 0
$fn$ language sql stable security definer set search_path = public;
