import { BAR_START, BAR_STEP, MATCH_SECONDS } from "./config";

type Props = { myReps: number; oppReps: number; myName?: string; oppName?: string; secondsLeft?: number };

function Avatar({ color }: { color: "me" | "opp" }) {
  return (
    <div className={`hex ${color}`}>
      <div className="hex-inner">
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <circle cx="20" cy="15" r="7" fill="#8a8f98" />
          <path d="M6 40c0-9 6.3-14 14-14s14 5 14 14z" fill="#8a8f98" />
        </svg>
      </div>
    </div>
  );
}

export default function Hud({ myReps, oppReps, myName = "You", oppName = "Opponent", secondsLeft = MATCH_SECONDS }: Props) {
  const bar = Math.min(100, Math.max(0, BAR_START + BAR_STEP * (myReps - oppReps)));
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <header className="hud">
      <div className="hud-title">
        <span className="rule" />
        PUSHUP BATTLE
        <span className="rule" />
      </div>
      <div className="hud-row">
        <div className="player">
          <Avatar color="me" />
          <div className="name">{myName}</div>
        </div>
        <div className="timer">
          {mm}:{ss}
        </div>
        <div className="player">
          <Avatar color="opp" />
          <div className="name">{oppName}</div>
        </div>
      </div>
      <div className="hud-bar-row">
        <div className="score me">{myReps}</div>
        <div className="bar">
          <div className="bar-me" style={{ width: `${bar}%` }} />
        </div>
        <div className="score opp">{oppReps}</div>
      </div>
    </header>
  );
}
