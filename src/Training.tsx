import { useEffect, useRef, useState } from "react";
import { TRAINING, TRAINING_CAP } from "./config";
import { supabase } from "./supabase";
import { countdownSound, goSound, victoryCall, victorySound, defeatSound } from "./sound";

type Challenge = (typeof TRAINING)[number];
type Run = { c: Challenge; runId: number | null; phase: "countdown" | "go" | "done"; count: number; endAt: number; base: number; won?: boolean; gain?: number | null; error?: string };

// Training ground: free practice plus timed challenges that pay Respect, at most 50 per 24 hours.
type Today = { earned: number; nextFree: Date | null };
const untilText = (d: Date | null) => {
  if (!d) return "";
  const m = Math.max(0, Math.ceil((d.getTime() - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
export default function Training({ reps, onReset, onBattle, onEarned }: { reps: number; onReset: () => void; onBattle: () => void; onEarned: () => void }) {
  const [view, setView] = useState<"free" | "challenges">("challenges");
  const [run, setRun] = useState<Run | null>(null);
  const [now, setNow] = useState(Date.now());
  const [today, setToday] = useState<Today | null>(null);
  const loadToday = async () => {
    const { data, error } = (await supabase?.rpc("training_today")) ?? {};
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row) setToday({ earned: row.earned ?? 0, nextFree: row.next_free ? new Date(row.next_free) : null });
  };
  useEffect(() => { loadToday(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const left = today ? Math.max(0, TRAINING_CAP - today.earned) : TRAINING_CAP;
  const repsRef = useRef(reps);
  repsRef.current = reps;

  const start = async (c: Challenge) => {
    let runId: number | null = null;
    if (supabase) {
      const { data, error } = await supabase.rpc("start_training", { p_challenge: c.id });
      if (!error) runId = data as number;
    }
    setRun({ c, runId, phase: "countdown", count: 3, endAt: 0, base: repsRef.current });
  };

  // countdown, then the challenge clock
  useEffect(() => {
    if (!run || run.phase === "done") return;
    if (run.phase === "countdown") {
      if (run.count <= 0) {
        goSound();
        setRun({ ...run, phase: "go", endAt: Date.now() + run.c.seconds * 1000, base: repsRef.current });
        return;
      }
      countdownSound();
      const t = setTimeout(() => setRun((r) => r && { ...r, count: r.count - 1 }), 1000);
      return () => clearTimeout(t);
    }
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [run?.phase, run?.count]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = run?.phase === "go" ? reps - run.base : 0;
  useEffect(() => {
    if (!run || run.phase !== "go") return;
    if (done >= run.c.reps) {
      victorySound();
      victoryCall();
      setRun({ ...run, phase: "done", won: true, gain: null });
      (async () => {
        if (!supabase || run.runId === null) return setRun((r) => r && { ...r, gain: 0, error: "Respect isn't set up yet" });
        const { data, error } = await supabase.rpc("claim_training", { p_run: run.runId, p_reps: done });
        setRun((r) => r && { ...r, gain: error ? 0 : (data as number), error: error?.message });
        onEarned();
        loadToday();
      })();
    } else if (now >= run.endAt) {
      defeatSound();
      setRun({ ...run, phase: "done", won: false });
    }
  }, [done, now]); // eslint-disable-line react-hooks/exhaustive-deps

  if (run) {
    const left = run.phase === "go" ? Math.max(0, Math.ceil((run.endAt - now) / 1000)) : run.c.seconds;
    return (
      <>
        {run.phase === "countdown" && (
          <div className="stage-center"><div key={run.count} className="countdown">{run.count > 0 ? run.count : "GO"}</div></div>
        )}
        <div className="practice train-run panel">
          <div className="practice-label">{run.c.name} · {run.c.reps} reps in {run.c.seconds} s</div>
          {run.phase === "done" ? (
            <>
              <div className={`brush-title train-result ${run.won ? "won" : "lost"}`}>{run.won ? "Complete!" : "Time's up"}</div>
              <div className="muted">
                {!run.won ? `${done} of ${run.c.reps} reps. Try again!` :
                  run.gain == null ? "Claiming…" :
                  run.error ? run.error :
                  run.gain > 0 ? <span className="respect-gain">+{run.gain} Respect</span> :
                  `You've earned today's ${TRAINING_CAP} from training. More in ${untilText(today?.nextFree ?? null)}.`}
              </div>
              <div className="practice-actions">
                <button className="pill ghost" onClick={() => setRun(null)}>Back</button>
                <button className="pill" onClick={() => start(run.c)}>Again</button>
              </div>
            </>
          ) : (
            <>
              <div className="practice-reps">{done}<span className="of"> / {run.c.reps}</span></div>
              <div className="train-clock">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</div>
              <button className="pill ghost" onClick={() => setRun(null)}>Stop</button>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="practice panel training">
      <div className="seg">
        <button className={view === "challenges" ? "on" : ""} onClick={() => setView("challenges")}>Challenges</button>
        <button className={view === "free" ? "on" : ""} onClick={() => setView("free")}>Free practice</button>
      </div>
      {view === "free" ? (
        <>
          <div className="practice-reps">{reps}</div>
          <div className="practice-actions">
            <button className="pill ghost" onClick={onReset}>Reset</button>
            <button className="pill" onClick={onBattle}>Battle a friend</button>
          </div>
        </>
      ) : (
        <>
          <div className="muted small">
            {left > 0
              ? `Today: ${today?.earned ?? 0} / ${TRAINING_CAP} Respect from training. ${left} left.`
              : `Today's ${TRAINING_CAP} from training is earned. More in ${untilText(today?.nextFree ?? null)}.`}
          </div>
          <ul className="train-list">
            {TRAINING.map((c) => (
              <li key={c.id}>
                <button onClick={() => start(c)}>
                  <b>{c.name}</b>
                  <span>{c.reps} reps · {c.seconds < 60 ? `${c.seconds} s` : `${c.seconds / 60} min`}</span>
                  <em>+{c.reward}</em>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
