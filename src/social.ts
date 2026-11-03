import { supabase } from "./supabase";
import { MODES, type ModeId } from "./config";
import { clanById, type Clan } from "./clans";
import type { Profile } from "./auth";

// Profiles, follows, likes and battle history (supabase/social.sql).

export type Social = { followers: number; following: number; likes: number; dislikes: number; iFollow: boolean; myVote: 1 | -1 | 0 };
export type HistoryRow = { id: string; mode: ModeId; when: Date; myReps: number | null; oppReps: number | null; opponent: string; oppId: string; oppAvatar: string | null; oppLegendary: boolean; result: "win" | "lose" | "draw" | "pending"; delta: number };

const count = async (table: string, col: string, id: string, extra?: [string, number]) => {
  if (!supabase) return 0;
  let q = supabase.from(table).select("*", { count: "exact", head: true }).eq(col, id);
  if (extra) q = q.eq(extra[0], extra[1]);
  const { count: n } = await q;
  return n ?? 0;
};

export async function loadProfile(id: string): Promise<{ profile: Profile | null; clan: Clan | null }> {
  if (!supabase) return { profile: null, clan: null };
  const [p, m] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
    supabase.from("clan_members").select("clan_id").eq("user_id", id).gt("expires_at", new Date().toISOString()).maybeSingle(),
  ]);
  return { profile: (p.data as Profile) ?? null, clan: clanById(m.data?.clan_id) };
}

export async function loadSocial(id: string, me: string): Promise<Social> {
  const [followers, following, likes, dislikes] = await Promise.all([
    count("follows", "followee", id),
    count("follows", "follower", id),
    count("profile_votes", "target", id, ["vote", 1]),
    count("profile_votes", "target", id, ["vote", -1]),
  ]);
  let iFollow = false, myVote: 1 | -1 | 0 = 0;
  if (supabase && id !== me) {
    const [f, v] = await Promise.all([
      supabase.from("follows").select("follower").eq("follower", me).eq("followee", id).maybeSingle(),
      supabase.from("profile_votes").select("vote").eq("voter", me).eq("target", id).maybeSingle(),
    ]);
    iFollow = !!f.data;
    myVote = (v.data?.vote as 1 | -1 | undefined) ?? 0;
  }
  return { followers, following, likes, dislikes, iFollow, myVote };
}

export async function setFollow(me: string, id: string, on: boolean) {
  if (!supabase) return;
  if (on) await supabase.from("follows").insert({ follower: me, followee: id });
  else await supabase.from("follows").delete().eq("follower", me).eq("followee", id);
}

// Tapping the same vote again removes it.
export async function setVote(me: string, id: string, vote: 1 | -1 | 0) {
  if (!supabase) return;
  if (vote === 0) await supabase.from("profile_votes").delete().eq("voter", me).eq("target", id);
  else await supabase.from("profile_votes").upsert({ voter: me, target: id, vote });
}

// You can only dislike someone you've beaten in a Rank match (the server checks this too).
export async function beatInRank(me: string, id: string) {
  if (!supabase) return false;
  const { data } = await supabase.from("matches").select("id").eq("mode", "rank").eq("winner", me)
    .or(`player_a.eq.${id},player_b.eq.${id}`).limit(1);
  return Array.isArray(data) && data.length > 0;
}

export const HISTORY_SIZE = 20; // battles shown on a profile

export async function loadHistory(id: string): Promise<HistoryRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("matches")
    .select("*, a:profiles!matches_player_a_fkey(username, avatar_url, legendary), b:profiles!matches_player_b_fkey(username, avatar_url, legendary)")
    .or(`player_a.eq.${id},player_b.eq.${id}`)
    .order("started_at", { ascending: false })
    .limit(HISTORY_SIZE);
  if (error || !Array.isArray(data)) return [];
  return data.map((m) => {
    const meA = m.player_a === id;
    const one = (x: unknown) => (Array.isArray(x) ? x[0] : x) as { username?: string; avatar_url?: string | null; legendary?: boolean } | null;
    const opp = one(meA ? m.b : m.a);
    const bothPaid = m.a_paid && m.b_paid;
    const result = !m.settled_at ? "pending" : !bothPaid || !m.winner ? "draw" : m.winner === id ? "win" : "lose";
    const myReps = meA ? m.a_reps : m.b_reps;
    const penalty = m.mode === "brawl" && bothPaid && (myReps ?? 0) < 5 ? -1 : 0;
    return {
      id: m.id,
      mode: m.mode,
      when: new Date(m.started_at),
      myReps,
      oppReps: meA ? m.b_reps : m.a_reps,
      opponent: opp?.username ?? "?",
      oppId: meA ? m.player_b : m.player_a,
      oppAvatar: opp?.avatar_url ?? null,
      oppLegendary: !!opp?.legendary,
      result,
      delta: (result === "win" ? m.bet : result === "lose" ? -m.bet : 0) + penalty,
    } as HistoryRow;
  });
}

export const modeName = (m: ModeId) => MODES[m]?.name ?? m;
