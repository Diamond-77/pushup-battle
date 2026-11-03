import { useState } from "react";
import Avatar from "./Avatar";
import { MODES, type ModeId } from "./config";
import type { Player } from "./lobby";
import {
  answerChallenge, cancelChallenge, checkInChallenge, sendChallenge, untilText, whenText,
  CHALLENGE_STAKE, type ChallengeView,
} from "./challenges";

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const roundUp = (d: Date, min = 15) => new Date(Math.ceil(d.getTime() / (min * 60000)) * min * 60000);
const at = (days: number, h: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d; };

// Pick a battle mode and a time. Used to send a challenge and to send back a changed one.
export function ChallengeComposer({ name, avatar, start, onSend, onClose, title = "Challenge" }: {
  name: string; avatar: string | null; start?: { mode: ModeId; at: Date };
  onSend: (mode: ModeId, at: Date) => Promise<string | null>; onClose: () => void; title?: string;
}) {
  const [mode, setMode] = useState<ModeId>(start?.mode ?? "classic");
  const [when, setWhen] = useState(localInput(start?.at ?? roundUp(new Date(Date.now() + 3600000))));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const quick: [string, Date][] = [
    ["In 1 hour", roundUp(new Date(Date.now() + 3600000))],
    ["Tonight 8 PM", at(new Date().getHours() >= 19 ? 1 : 0, 20)],
    ["Tomorrow 7 AM", at(1, 7)],
  ];
  const send = async () => {
    setBusy(true);
    setErr(null);
    const e = await onSend(mode, new Date(when));
    setBusy(false);
    if (e) setErr(e); else onClose();
  };
  return (
    <div className="modal-back challenge-back" onClick={onClose}>
      <div className="modal panel composer" onClick={(e) => e.stopPropagation()}>
        <div className="composer-head">
          <Avatar url={avatar} color="opp" size={54} />
          <div>
            <div className="modal-title">{title}</div>
            <div className="muted small">vs <b>{name}</b></div>
          </div>
        </div>
        <div className="section-title">Battle</div>
        <div className="mode-chips">
          {(Object.keys(MODES) as ModeId[]).map((m) => (
            <button key={m} className={`mode-chip ${m === mode ? "on" : ""}`} onClick={() => setMode(m)}>
              <b>{MODES[m].name}</b>
              <span>{MODES[m].seconds / 60} min · bet {MODES[m].bet}</span>
            </button>
          ))}
        </div>
        <div className="section-title">When</div>
        <div className="quick-times">
          {quick.map(([label, d]) => (
            <button key={label} className={`pill ghost ${localInput(d) === when ? "on" : ""}`} onClick={() => setWhen(localInput(d))}>{label}</button>
          ))}
        </div>
        <input className="time-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <p className="muted small stake-note">
          You put down <b>{CHALLENGE_STAKE} Respect</b>. If you don't show up, the other player gets it. Both show up and you get it back.
        </p>
        {err && <p className="form-msg">{err}</p>}
        <div className="row stretch">
          <button className="game-btn wood" onClick={onClose}>Cancel</button>
          <button className="game-btn red" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send"}</button>
        </div>
      </div>
    </div>
  );
}

// Send a challenge to a player (from their profile).
export function SendChallenge({ id, name, avatar, mode, onClose, onSent }: { id: string; name: string; avatar: string | null; mode?: ModeId; onClose: () => void; onSent?: () => void }) {
  return (
    <ChallengeComposer name={name} avatar={avatar} start={mode ? { mode, at: roundUp(new Date(Date.now() + 3600000)) } : undefined}
      onClose={onClose}
      onSend={async (m, d) => { const e = await sendChallenge(id, m, d); if (!e) onSent?.(); return e; }} />
  );
}

// The challenge mailbox on Home.
export function ChallengeBox({ list, now, online, onStart, onChanged, onPlayer }: {
  list: ChallengeView[]; now: number; online: Player[];
  onStart: (p: Player, mode: ModeId) => void; onChanged: () => void; onPlayer: (id: string) => void;
}) {
  const [editing, setEditing] = useState<ChallengeView | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (p: Promise<string | null>) => { const e = await p; setMsg(e); onChanged(); };
  return (
    <div className="challenge-box">
      <div className="cb-head">
        <span className="section-title">Challenges</span>
        {list.length > 0 && <span className="cb-count">{list.length}</span>}
      </div>
      {list.length === 0 && <div className="muted small">No challenges yet. Open a player's profile and tap Challenge.</div>}
      {msg && <p className="form-msg">{msg}</p>}
      <ul className="cb-list">
        {list.map((c) => {
          const opp = online.find((p) => p.id === c.other.id);
          const ms = c.when.getTime() - now;
          return (
            <li key={c.id} className={`cb-item ${c.myTurn || (c.status === "accepted" && c.window === "open") ? "hot" : ""}`}>
              <button className="cb-avatar" onClick={() => onPlayer(c.other.id)} aria-label={`Open ${c.other.username}'s profile`}>
                <Avatar url={c.other.avatar_url} color="opp" size={46} legendary={c.other.legendary} />
                {(c.myTurn || (c.status === "accepted" && c.window === "open" && !c.iIn)) && <i className="ping" />}
              </button>
              <div className="cb-text">
                <div className="pl-name">{c.mine ? `You vs ${c.other.username}` : `${c.other.username} challenges you`}</div>
                <div className="cb-when"><b>{MODES[c.mode].name}</b> · {whenText(c.when)} <span>({untilText(ms)})</span></div>
                <div className="cb-status">
                  {c.status === "pending" && (c.myTurn ? (c.proposer === c.from_user && !c.mine ? "Waiting for your answer" : "They changed it. Your answer?") : `Waiting for ${c.other.username}`)}
                  {c.status === "accepted" && c.window === "early" && "Accepted. You'll be reminded."}
                  {c.status === "accepted" && c.window === "open" && (c.iIn ? (c.theyIn ? (opp ? "Both here. Start!" : `${c.other.username} checked in, waiting for them to come online`) : `Waiting for ${c.other.username} to check in`) : "It's time! Check in.")}
                </div>
                <div className="cb-actions">
                  {c.status === "pending" && c.myTurn && (
                    <>
                      <button className="pill" onClick={() => act(answerChallenge(c.id, "accept"))}>Accept</button>
                      <button className="pill ghost" onClick={() => setEditing(c)}>Change</button>
                      <button className="pill ghost" onClick={() => act(answerChallenge(c.id, "decline"))}>Decline</button>
                    </>
                  )}
                  {c.status === "pending" && !c.myTurn && <button className="pill ghost" onClick={() => act(cancelChallenge(c.id))}>Call off</button>}
                  {c.status === "accepted" && c.window === "open" && !c.iIn && <button className="pill" onClick={() => act(checkInChallenge(c.id))}>I'm here</button>}
                  {c.status === "accepted" && c.window === "open" && c.iIn && c.theyIn && opp && (
                    <button className="pill" onClick={() => onStart(opp, c.mode)}>Start battle</button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {editing && (
        <ChallengeComposer title="Change challenge" name={editing.other.username} avatar={editing.other.avatar_url}
          start={{ mode: editing.mode, at: editing.when }} onClose={() => setEditing(null)}
          onSend={async (m, d) => { const e = await answerChallenge(editing.id, "counter", m, d); onChanged(); return e; }} />
      )}
    </div>
  );
}
