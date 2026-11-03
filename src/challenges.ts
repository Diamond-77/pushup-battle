import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { ModeId } from "./config";

// Scheduled challenges (supabase/challenges.sql). The server holds the 4 Respect stakes and decides payouts.

export const CHALLENGE_STAKE = 4;
export const CHECKIN_BEFORE_MIN = 10; // check in from 10 minutes before the time...
export const CHECKIN_AFTER_MIN = 15; // ...until 15 minutes after

export type ChallengeRow = {
  id: number;
  from_user: string;
  to_user: string;
  mode: ModeId;
  at: string;
  status: "pending" | "accepted" | "declined" | "cancelled" | "settled";
  proposer: string;
  from_in: string | null;
  to_in: string | null;
  outcome: string | null;
  other: { id: string; username: string; avatar_url: string | null; legendary?: boolean };
};

export type ChallengeView = ChallengeRow & {
  when: Date;
  mine: boolean; // I sent it
  myTurn: boolean; // waiting for my answer
  iIn: boolean;
  theyIn: boolean;
  window: "early" | "open" | "over";
};

const one = <T,>(x: T | T[]) => (Array.isArray(x) ? x[0] : x);

export function viewOf(c: ChallengeRow, me: string, now = Date.now()): ChallengeView {
  const when = new Date(c.at);
  const t = when.getTime();
  const window = now < t - CHECKIN_BEFORE_MIN * 60000 ? "early" : now <= t + CHECKIN_AFTER_MIN * 60000 ? "open" : "over";
  const mine = c.from_user === me;
  return {
    ...c, when, mine, window,
    myTurn: c.status === "pending" && c.proposer !== me,
    iIn: !!(mine ? c.from_in : c.to_in),
    theyIn: !!(mine ? c.to_in : c.from_in),
  };
}

export async function loadChallenges(me: string): Promise<ChallengeRow[]> {
  if (!supabase) return [];
  await supabase.rpc("settle_my_challenges");
  const { data, error } = await supabase
    .from("challenges")
    .select("*, f:profiles!challenges_from_user_fkey(id, username, avatar_url, legendary), t:profiles!challenges_to_user_fkey(id, username, avatar_url, legendary)")
    .or(`from_user.eq.${me},to_user.eq.${me}`)
    .in("status", ["pending", "accepted"])
    .order("at", { ascending: true })
    .limit(30);
  if (error || !Array.isArray(data)) return [];
  return data.map((r) => ({ ...r, other: one(r.from_user === me ? r.t : r.f) }) as ChallengeRow);
}

const call = async (fn: string, args: Record<string, unknown>) => {
  if (!supabase) return "Not connected";
  const { error } = await supabase.rpc(fn, args);
  if (!error) return null;
  return /function|schema cache/i.test(error.message) ? "Challenges aren't set up yet (run challenges.sql)" : error.message;
};
export const sendChallenge = (to: string, mode: ModeId, at: Date) => call("send_challenge", { p_to: to, p_mode: mode, p_at: at.toISOString() });
export const answerChallenge = (id: number, action: "accept" | "decline" | "counter", mode?: ModeId, at?: Date) =>
  call("respond_challenge", { p_id: id, p_action: action, p_mode: mode ?? null, p_at: at ? at.toISOString() : null });
export const cancelChallenge = (id: number) => call("cancel_challenge", { p_id: id });
export const checkInChallenge = (id: number) => call("check_in_challenge", { p_id: id });

// My open challenges, refreshed every 30 seconds (and right after anything I do).
export function useChallenges(me: string) {
  const [rows, setRows] = useState<ChallengeRow[]>([]);
  const [now, setNow] = useState(Date.now());
  const refresh = useCallback(async () => { setRows(await loadChallenges(me)); setNow(Date.now()); }, [me]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    const tick = setInterval(() => setNow(Date.now()), 15000);
    const ev = () => refresh();
    window.addEventListener("pb:challenges", ev);
    return () => { clearInterval(t); clearInterval(tick); window.removeEventListener("pb:challenges", ev); };
  }, [refresh]);
  const list = rows.map((r) => viewOf(r, me, now)).filter((c) => c.window !== "over" || c.status === "pending");
  // red ping: challenges waiting for my answer, or ready to check in
  const ping = list.filter((c) => c.myTurn || (c.status === "accepted" && c.window === "open" && !c.iIn)).length;
  return { list, ping, refresh, now };
}

export const whenText = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function untilText(ms: number) {
  const m = Math.round(ms / 60000);
  if (m <= 0) return "now";
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h} h ${m % 60} min`;
  const d = Math.round(h / 24);
  return `in ${d} ${d === 1 ? "day" : "days"}`;
}

// tell the mailbox something changed (e.g. a challenge was sent from a profile)
export const challengesChanged = () => window.dispatchEvent(new Event("pb:challenges"));
