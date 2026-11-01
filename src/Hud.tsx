import Avatar from "./Avatar";
import { barValue } from "./match";

type Side = { name: string; avatar: string | null };
type Props = { myReps: number; oppReps: number; me: Side; opp: Side; secondsLeft: number };

export default function Hud({ myReps, oppReps, me, opp, secondsLeft }: Props) {
  const bar = barValue(myReps, oppReps);
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
          <Avatar url={me.avatar} color="me" />
          <div className="name">{me.name}</div>
        </div>
        <div className="timer">
          {mm}:{ss}
        </div>
        <div className="player">
          <Avatar url={opp.avatar} color="opp" />
          <div className="name">{opp.name}</div>
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
