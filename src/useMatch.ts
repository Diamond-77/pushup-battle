import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { COUNTDOWN_SECONDS, MATCH_SECONDS } from "./config";
import type { MatchInfo } from "./lobby";
import { barValue } from "./match";
import { supabase } from "./supabase";

export type Phase = "waiting" | "countdown" | "match" | "result";
type MatchMsg = { type: "go" } | { type: "rep"; from: string; reps: number };

// One match on the Realtime channel match:{matchId}. Broadcast carries go/rep messages;
// presence is only used so the creator knows when the opponent has joined before sending "go".
export function useMatch(info: MatchInfo | null, myId: string) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [myReps, setMyReps] = useState(0);
  const [oppReps, setOppReps] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [secondsLeft, setSecondsLeft] = useState(MATCH_SECONDS);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const myRepsRef = useRef(0);
  const phaseRef = useRef<Phase>("waiting");
  phaseRef.current = phase;

  const send = (msg: MatchMsg) => channelRef.current?.send({ type: "broadcast", event: "msg", payload: msg });

  const start = () => {
    myRepsRef.current = 0;
    setMyReps(0);
    setOppReps(0);
    setSecondsLeft(MATCH_SECONDS);
    setCountdown(COUNTDOWN_SECONDS);
    phaseRef.current = "countdown"; // so a second presence sync can't send "go" twice
    setPhase("countdown");
  };

  useEffect(() => {
    if (!supabase || !info) return;
    setPhase("waiting");
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
        else if (msg.type === "rep" && msg.from !== myId && phaseRef.current === "match") setOppReps(msg.reps);
      })
      .subscribe((s) => {
        if (s === "SUBSCRIBED") channel.track({ id: myId });
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
    const endAt = Date.now() + MATCH_SECONDS * 1000;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setPhase("result");
    }, 200);
    return () => clearInterval(t);
  }, [phase]);

  // The match ends early when the bar hits either end.
  const bar = barValue(myReps, oppReps);
  useEffect(() => {
    if (phase === "match" && (bar <= 0 || bar >= 100)) setPhase("result");
  }, [phase, bar]);

  const addMyRep = useCallback(() => {
    if (phaseRef.current !== "match") return;
    myRepsRef.current += 1;
    setMyReps(myRepsRef.current);
    send({ type: "rep", from: myId, reps: myRepsRef.current });
  }, [myId]);  

  const result: "win" | "lose" | "draw" = myReps > oppReps ? "win" : myReps < oppReps ? "lose" : "draw";
  return { phase, myReps, oppReps, countdown, secondsLeft, addMyRep, result };
}
