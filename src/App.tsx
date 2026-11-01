import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { COUNTDOWN_SECONDS, MATCH_SECONDS } from "./config";
import Hud from "./Hud";
import { barValue } from "./match";
import PoseCounter from "./PoseCounter";
import { supabase } from "./supabase";

type Phase = "ready" | "countdown" | "match" | "result";
type MatchMsg = { type: "go" } | { type: "rep"; from: string; reps: number };

// Temporary for step 3: every tab joins this one match so two tabs/phones can play.
const TEMP_MATCH_ID = "test";
const MY_ID = crypto.randomUUID();

export default function App() {
  const [phase, setPhase] = useState<Phase>("ready");
  const [myReps, setMyReps] = useState(0);
  const [oppReps, setOppReps] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [secondsLeft, setSecondsLeft] = useState(MATCH_SECONDS);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const myRepsRef = useRef(0);
  const phaseRef = useRef<Phase>("ready");
  phaseRef.current = phase;

  const send = (msg: MatchMsg) => channelRef.current?.send({ type: "broadcast", event: "msg", payload: msg });

  const start = () => {
    myRepsRef.current = 0;
    setMyReps(0);
    setOppReps(0);
    setSecondsLeft(MATCH_SECONDS);
    setCountdown(COUNTDOWN_SECONDS);
    setPhase("countdown");
  };

  // Realtime match channel (broadcast only). The opponent's reps come only from these messages.
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase.channel(`match:${TEMP_MATCH_ID}`, { config: { broadcast: { self: false } } });
    channel
      .on("broadcast", { event: "msg" }, ({ payload }) => {
        const msg = payload as MatchMsg;
        if (msg.type === "go") start();
        else if (msg.type === "rep" && msg.from !== MY_ID && phaseRef.current === "match") setOppReps(msg.reps);
      })
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase?.removeChannel(channel);
    };
  }, []);

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
    myRepsRef.current += 1;
    setMyReps(myRepsRef.current);
    send({ type: "rep", from: MY_ID, reps: myRepsRef.current });
  }, []);

  // The match creator (whoever taps Start) tells everyone in the match to start.
  const goAll = () => {
    send({ type: "go" });
    start();
  };

  const result = myReps > oppReps ? "win" : myReps < oppReps ? "lose" : "draw";

  return (
    <main className="app">
      <PoseCounter counting={phase === "match"} onRep={addMyRep}>
        <Hud myReps={myReps} oppReps={oppReps} secondsLeft={secondsLeft} />

        {phase === "ready" && (
          <div className="stage-center">
            <button className="big-btn" onClick={goAll} disabled={!connected}>
              Start
            </button>
            <div className="hint">
              {!supabase
                ? "Supabase env vars missing"
                : connected
                  ? "Connected. Tap Start on one phone, both start"
                  : "Connecting…"}
            </div>
          </div>
        )}

        {phase === "countdown" && (
          <div className="stage-center">
            <div key={countdown} className="countdown">
              {countdown > 0 ? countdown : "GO"}
            </div>
          </div>
        )}

        {phase === "result" && (
          <div className="stage-center">
            <div className={`result-card ${result}`}>
              <div className="result-title">{result === "win" ? "You win!" : result === "lose" ? "You lose" : "Draw"}</div>
              <div className="result-score">
                <span className="me">{myReps}</span>
                <span className="dash">–</span>
                <span className="opp">{oppReps}</span>
              </div>
              <button className="big-btn small" onClick={goAll}>
                Play again
              </button>
            </div>
          </div>
        )}

        {/* Debug: fake a rep without doing a push-up (for testing with two tabs) */}
        {phase === "match" && (
          <div className="test-btns">
            <button onClick={addMyRep}>+1 me</button>
          </div>
        )}
      </PoseCounter>
    </main>
  );
}
