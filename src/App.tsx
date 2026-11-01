import { useCallback, useEffect, useState } from "react";
import { COUNTDOWN_SECONDS, MATCH_SECONDS } from "./config";
import Hud from "./Hud";
import { barValue } from "./match";
import PoseCounter from "./PoseCounter";

type Phase = "ready" | "countdown" | "match" | "result";

export default function App() {
  const [phase, setPhase] = useState<Phase>("ready");
  const [myReps, setMyReps] = useState(0);
  const [oppReps, setOppReps] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [secondsLeft, setSecondsLeft] = useState(MATCH_SECONDS);

  const start = () => {
    setMyReps(0);
    setOppReps(0);
    setSecondsLeft(MATCH_SECONDS);
    setCountdown(COUNTDOWN_SECONDS);
    setPhase("countdown");
  };

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

  const addMyRep = useCallback(() => setMyReps((r) => r + 1), []);

  const result = myReps > oppReps ? "win" : myReps < oppReps ? "lose" : "draw";

  return (
    <main className="app">
      <PoseCounter counting={phase === "match"} onRep={addMyRep}>
        <Hud myReps={myReps} oppReps={oppReps} secondsLeft={secondsLeft} />

        {phase === "ready" && (
          <div className="stage-center">
            <button className="big-btn" onClick={start}>
              Start
            </button>
            <div className="hint">Get in position, then tap Start</div>
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
              <button className="big-btn small" onClick={start}>
                Play again
              </button>
            </div>
          </div>
        )}

        {/* Test buttons standing in for the opponent until two-device play exists */}
        {phase === "match" && (
          <div className="test-btns">
            <button onClick={addMyRep}>+1 me</button>
            <button className="red" onClick={() => setOppReps((r) => r + 1)}>
              +1 red
            </button>
          </div>
        )}
      </PoseCounter>
    </main>
  );
}
