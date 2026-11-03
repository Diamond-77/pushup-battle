import { useCallback, useEffect, useRef } from "react";
import { supabase } from "./supabase";

// Lifetime push-ups and the profile card numbers (supabase/pushups.sql).

export type DayReps = { day: string; reps: number }; // day = "YYYY-MM-DD"
export type PlayerCard = {
  total: number;
  best_day: number;
  active_days: number;
  streak: number;
  best_streak: number;
  today: string;
  recent: DayReps[];
  wins: number;
  battles: number;
  best_battle: number;
  throne_rank: number;
  clan_rank: number;
  clan_size: number;
};

const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const EMPTY_CARD: PlayerCard = {
  total: 0, best_day: 0, active_days: 0, streak: 0, best_streak: 0, today: localDay(), recent: [],
  wins: 0, battles: 0, best_battle: 0, throne_rank: 0, clan_rank: 0, clan_size: 0,
};

export async function loadCard(id: string): Promise<PlayerCard> {
  if (!supabase) return EMPTY_CARD;
  const { data, error } = await supabase.rpc("player_card", { p_user: id });
  if (error || !data) return EMPTY_CARD;
  return { ...EMPTY_CARD, ...(data as Partial<PlayerCard>) };
}

export type FollowPerson = { id: string; username: string; avatar_url: string | null; legendary: boolean; title: string | null; respect: number };

// The players following `id` (followers) or followed by `id` (following).
export async function loadFollowList(id: string, kind: "followers" | "following"): Promise<FollowPerson[]> {
  if (!supabase) return [];
  const col = kind === "followers" ? "followee" : "follower";
  const other = kind === "followers" ? "follower" : "followee";
  const { data, error } = await supabase
    .from("follows")
    .select(`p:profiles!follows_${other}_fkey(id, username, avatar_url, legendary, title, respect)`)
    .eq(col, id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !Array.isArray(data)) return [];
  return data
    .map((r) => (Array.isArray(r.p) ? r.p[0] : r.p) as FollowPerson | null)
    .filter((p): p is FollowPerson => !!p);
}

// Training reps are sent to the server in small batches (battles are counted by the server itself).
export function usePushupLog() {
  const pending = useRef(0);
  const flush = useCallback(() => {
    const n = pending.current;
    if (!n || !supabase) return;
    pending.current = 0;
    supabase.rpc("log_pushups", { p_reps: n }).then(({ error }) => {
      if (error && !/function|schema cache/i.test(error.message)) pending.current += n; // try again later
    });
  }, []);
  useEffect(() => {
    const t = setInterval(flush, 8000);
    const hide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", flush);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);
  const add = useCallback(() => { pending.current += 1; }, []);
  return { add, flush };
}

// Every day a player did push-ups, newest first (up to a year).
export async function loadDays(id: string): Promise<DayReps[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("pushup_days").select("day, reps").eq("user_id", id).gt("reps", 0).order("day", { ascending: false }).limit(366);
  return error || !Array.isArray(data) ? [] : (data as DayReps[]);
}
