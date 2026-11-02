import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { BRAWL_MIN_REPS, COUNTDOWN_SECONDS, MODES } from "./config";
import type { MatchInfo } from "./lobby";
import { barValue } from "./match";
import { supabase } from "./supabase";

export type Phase = "waiting" | "countdown" | "match" | "result" | "cancelled";
type MatchMsg = { type: "go" } | { type: "rep"; from: string; reps: number } | { type: "cancel"; reason: string };
// Respect change after the server settles the match (null while waiting)
export type Payout = { delta: number; settled: boolean } | null;

// The economy SQL may not be installed yet: then battles still work, just without Respect.
const missingFn = (e: { code?: string; message?: string }) => e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? "");

// One match on the Realtime channel match:{matchId}. Broadcast carries go/rep messages;
// presence is only used so the creator knows when the opponent has joined before sending "go".
export function useMatch(info: MatchInfo | null, myId: string, onSettled?: () => void) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [myReps, setMyReps] = useState(0);
  const [oppReps, setOppReps] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const mode = MODES[info?.mode ?? "classic"];
  const [secondsLeft, setSecondsLeft] = useState(mode.seconds);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [payout, setPayout] = useState<Payout>(null);
  const rankedRef = useRef(true); // false when the economy functions aren't installed
  const channelRef = useRef<RealtimeChannel | null>(null);
  const myRepsRef = useRef(0);
  const phaseRef = useRef<Phase>("waiting");
  phaseRef.current = phase;

  const send = (msg: MatchMsg) => channelRef.current?.send({ type: "broadcast", event: "msg", payload: msg });

  const start = () => {
    myRepsRef.current = 0;
    setMyReps(0);
    setOppReps(0);
    setSecondsLeft(mode.seconds);
    setCountdown(COUNTDOWN_SECONDS);
    phaseRef.current = "countdown"; // so a second presence sync can't send "go" twice
    setPhase("countdown");
  };

  useEffect(() => {
    if (!supabase || !info) return;
    setPhase("waiting");
    setPayout(null);
    setCancelReason(null);
    const channel = supabase.channel(`match:${info.matchId}`, {
      config: { presence: { key: myId }, broadcast: { self: false } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        const both = Object.keys(channel.presenceState()).length >= 2;
        if (info.creator && both && phaseRef.current === "waiting") {
          send({ type: "go" });
          start();
        }
      })
      .on("broadcast", { event: "msg" }, ({ payload }) => {
        const msg = payload as MatchMsg;
        if (msg.type === "go" && phaseRef.current === "waiting") start();
        else if (msg.type === "cancel" && phaseRef.current !== "result") { setCancelReason(msg.reason); setPhase("cancelled"); }
        else if (msg.type === "rep" && msg.from !== myId && phaseRef.current === "match") setOppReps(msg.reps);
      })
      .subscribe(async (s) => {
        if (s !== "SUBSCRIBED") return;
        // Pay the bet first; only then show up as "here", so the battle starts once both have paid.
        const { error } = await supabase!.rpc("join_match", { p_match: info.matchId, p_mode: info.mode, p_opponent: info.opponent.id });
        if (error && missingFn(error)) rankedRef.current = false;
        else if (error) {
          const reason = `${error.message}`;
          channel.send({ type: "broadcast", event: "msg", payload: { type: "cancel", reason: "Your opponent couldn't pay the bet. Nobody lost Respect." } });
          setCancelReason(reason);
          setPhase("cancelled");
          return;
        }
        channel.track({ id: myId });
      });
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase?.removeChannel(channel);
    };
  }, [info?.matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown: COUNTDOWN_SECONDS ... 1, then the match starts.
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      setPhase("match");
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // Match timer, based on an end time so it doesn't drift.
  useEffect(() => {
    if (phase !== "match") return;
    const endAt = Date.now() + mode.seconds * 1000;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setPhase("result");
    }, 200);
    return () => clearInterval(t);
  }, [phase]);

  // The match ends early when the bar hits either end.
  const bar = barValue(myReps, oppReps, mode.barStep);
  useEffect(() => {
    if (phase === "match" && (bar <= 0 || bar >= 100)) setPhase("result");
  }, [phase, bar]);

  const addMyRep = useCallback(() => {
    if (phaseRef.current !== "match") return;
    myRepsRef.current += 1;
    setMyReps(myRepsRef.current);
    send({ type: "rep", from: myId, reps: myRepsRef.current });
  }, [myId]);  

  // Brawl: fewer than 5 reps loses (both under 5 = draw), like the server decides.
  const result: "win" | "lose" | "draw" = (() => {
    if (info?.mode === "brawl") {
      const meLow = myReps < BRAWL_MIN_REPS, oppLow = oppReps < BRAWL_MIN_REPS;
      if (meLow && oppLow) return "draw";
      if (meLow) return "lose";
      if (oppLow) return "win";
    }
    return myReps > oppReps ? "win" : myReps < oppReps ? "lose" : "draw";
  })();

  // Report my reps once the match ends, then wait for the server to pay out.
  useEffect(() => {
    if (phase !== "result" || !supabase || !info || !rankedRef.current) return;
    let stop = false;
    const matchId = info.matchId;
    (async () => {
      const { error } = await supabase.rpc("report_match", { p_match: matchId, p_reps: myRepsRef.current });
      if (error) return;
      for (let i = 0; i < 40 && !stop; i++) {
        const { data } = await supabase.from("matches").select("*").eq("id", matchId).maybeSingle();
        if (data?.settled_at) {
          const meA = data.player_a === myId;
          const reps = meA ? data.a_reps : data.b_reps;
          const penalty = data.mode === "brawl" && (reps ?? 0) < BRAWL_MIN_REPS ? -1 : 0;
          const bothPaid = data.a_paid && data.b_paid;
          const delta = !bothPaid ? 0 : data.winner === myId ? data.bet : data.winner ? -data.bet : 0;
          setPayout({ delta: delta + (bothPaid ? penalty : 0), settled: true });
          onSettled?.();
          return;
        }
        await new Promise((r) => setTimeout(r, i < 10 ? 2000 : 5000));
        if (i > 10) await supabase.rpc("settle_my_matches");
      }
    })();
    return () => { stop = true; };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  return { phase, myReps, oppReps, countdown, secondsLeft, addMyRep, result, payout, cancelReason, ranked: rankedRef.current, mode };
}
