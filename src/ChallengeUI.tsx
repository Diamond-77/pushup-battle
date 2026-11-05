import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import { MODES, type ModeId } from "./config";
import type { BotMatch, Player } from "./lobby";
import { askBadgePermission } from "./badge";
import {
  answerChallenge, cancelChallenge, checkInChallenge, clashWith, isHot, reportNote, startChallengeMatch, markAcceptedSeen, sendChallenge, untilText, whenText,
  CHALLENGE_STAKE, CLASH_MIN, NOTE_MAX, type ChallengeView,
} from "./challenges";

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const roundUp = (d: Date, min = 15) => new Date(Math.ceil(d.getTime() / (min * 60000)) * min * 60000);
const at = (days: number, h: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d; };

// Pick a battle mode and a time. Used to send a challenge and to send back a changed one.
export function ChallengeComposer({ name, avatar, start, onSend, onClose, title = "Challenge", skipId, sendLabel = "Send" }: {
  name: string; avatar: string | null; start?: { mode: ModeId; at: Date }; skipId?: number; sendLabel?: string;
  onSend: (mode: ModeId, at: Date, note: string) => Promise<string | null>; onClose: () => void; title?: string;
}) {
  const [mode, setMode] = useState<ModeId>(start?.mode ?? "classic");
  const [when, setWhen] = useState(localInput(start?.at ?? roundUp(new Date(Date.now() + 3600000))));
  const [note, setNote] = useState("");
  const clash = clashWith(new Date(when), skipId);
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
    const e = await onSend(mode, new Date(when), note);
    setBusy(false);
    if (e) setErr(e); else onClose();
  };
  // drawn on top of everything (above the dock and the challenge window it may open from)
  return createPortal(
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
        {clash && (
          <div className="clash-warn">
            <Avatar url={clash.other.avatar_url} color="opp" size={30} />
            <span>You already booked <b>{clash.other.username}</b> at {whenText(clash.when)}. Pick a time at least {CLASH_MIN} min away.</span>
          </div>
        )}
        <div className="section-title">Note <span className="note-count">· {note.length}/{NOTE_MAX}</span></div>
        <input className="note-input" maxLength={NOTE_MAX} placeholder="Say something short (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="muted small stake-note">
          Nothing is taken now. Once it's accepted, you both put down <b>{CHALLENGE_STAKE} Respect</b>. Don't show up and the other player gets it. Both show up and you get it back.
        </p>
        {err && <p className="form-msg">{err}</p>}
        <div className="row stretch">
          <button className="game-btn wood" onClick={onClose}>Cancel</button>
          <button className="game-btn red" disabled={busy || !!clash} onClick={send}>{busy ? "Sending…" : sendLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Send a challenge to a player (from their profile).
export function SendChallenge({ id, name, avatar, mode, onClose, onSent }: { id: string; name: string; avatar: string | null; mode?: ModeId; onClose: () => void; onSent?: () => void }) {
  return (
    <ChallengeComposer name={name} avatar={avatar} start={mode ? { mode, at: roundUp(new Date(Date.now() + 3600000)) } : undefined}
      onClose={onClose}
      onSend={async (m, d, n) => { const e = await sendChallenge(id, m, d, n); if (!e) onSent?.(); return e; }} />
  );
}

// The challenge mailbox on Home.
export function ChallengeBox({ list, now, online, onStart, onBot, onChanged, onPlayer, empty = "No challenges yet. Open a player's profile and tap Challenge." }: {
  list: ChallengeView[]; now: number; online: Player[]; empty?: string; onBot?: (d: BotMatch, mode: ModeId) => void;
  onStart: (p: Player, mode: ModeId) => void; onChanged: () => void; onPlayer: (id: string) => void;
}) {
  const [editing, setEditing] = useState<ChallengeView | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (p: Promise<string | null>) => { const e = await p; setMsg(e); onChanged(); };
  return (
    <div className="challenge-box">
      {list.length === 0 && <div className="muted small cb-empty">{empty}</div>}
      {msg && <p className="form-msg">{msg}</p>}
      <ul className="cb-list">
        {list.map((c) => {
          const opp = online.find((p) => p.id === c.other.id);
          const ms = c.when.getTime() - now;
          return (
            <li key={c.id} className={`cb-item ${isHot(c) ? "hot" : ""}`}>
              <button className="cb-avatar" onClick={() => onPlayer(c.other.id)} aria-label={`Open ${c.other.username}'s profile`}>
                <Avatar url={c.other.avatar_url} color="opp" size={46} legendary={c.other.legendary} />
                {isHot(c) && <i className="ping" />}
              </button>
              <div className="cb-text">
                <div className="pl-name">{c.mine ? `You vs ${c.other.username}` : `${c.other.username} challenges you`}</div>
                <div className="cb-when"><b>{MODES[c.mode].name}</b> · {whenText(c.when)} <span>({untilText(ms)})</span></div>
                {c.note && <ChallengeNote c={c} />}
                <div className="cb-status">
                  {c.status === "pending" && (c.myTurn ? (c.proposer === c.from_user && !c.mine ? "Waiting for your answer" : `${c.other.username} sent it back with a new plan. Your answer?`) : `Waiting for ${c.other.username}`)}
                  {c.status === "accepted" && c.window === "early" && (c.proposer === (c.mine ? c.from_user : c.to_user) ? `${c.other.username} accepted! You'll be reminded.` : "Accepted. You'll be reminded.")}
                  {c.status === "accepted" && c.window === "open" && (c.iIn ? (c.theyIn ? "Both here. Start!" : `Waiting for ${c.other.username} to check in`) : "It's time! Check in.")}
                </div>
                <div className="cb-actions">
                  {c.status === "pending" && c.myTurn && (
                    <>
                      <button className="pill" onClick={() => {
                        const x = clashWith(c.when, c.id);
                        if (x && x.status === "accepted") return setMsg(`You already booked ${x.other.username} at ${whenText(x.when)}. Tap Suggest a time to send this one back.`);
                        act(answerChallenge(c.id, "accept"));
                      }}>Accept</button>
                      <button className="pill ghost" onClick={() => setEditing(c)}>Suggest a time</button>
                      <button className="pill ghost" onClick={() => act(answerChallenge(c.id, "decline"))}>Decline</button>
                    </>
                  )}
                  {c.status === "pending" && !c.myTurn && <button className="pill ghost" onClick={() => act(cancelChallenge(c.id))}>Call off</button>}
                  {c.status === "accepted" && c.window === "open" && !c.iIn && <button className="pill" onClick={() => act(checkInChallenge(c.id))}>I'm here</button>}
                  {c.status === "accepted" && c.window === "open" && c.iIn && c.theyIn && (
                    <button className="pill" onClick={async () => {
                      if (opp) return onStart(opp, c.mode);
                      const r = await startChallengeMatch(c.id);
                      if (r.data) { onBot?.(r.data, c.mode); onChanged(); }
                      else setMsg(r.error === "waiting" ? `${c.other.username} isn't online yet. Ask them to open the game.` : r.error ?? null);
                    }}>Start battle</button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {editing && (
        <ChallengeComposer title="Suggest a time" sendLabel="Send back" skipId={editing.id} name={editing.other.username} avatar={editing.other.avatar_url}
          start={{ mode: editing.mode, at: editing.when }} onClose={() => setEditing(null)}
          onSend={async (m, d, n) => { const e = await answerChallenge(editing.id, "counter", m, d, n); onChanged(); return e; }} />
      )}
    </div>
  );
}

// The note that came with the latest offer. Under it, a small line takes turns between a few tips;
// one of them is the reminder to report anything harmful, so the warning isn't there all the time.
const NOTE_TIPS = ["Only you two can see this note.", "Something harmful? Tap Report.", "Reply by sending it back with a note.", "Keep it friendly. Fight with push-ups."];
function ChallengeNote({ c }: { c: ChallengeView }) {
  const theirs = c.proposer !== (c.mine ? c.from_user : c.to_user);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * NOTE_TIPS.length));
  const [state, setState] = useState<"idle" | "ask" | "sent" | string>("idle");
  useEffect(() => { const t = setInterval(() => setTip((i) => (i + 1) % NOTE_TIPS.length), 4500); return () => clearInterval(t); }, []);
  return (
    <div className="cb-note">
      <div className="cb-note-text">
        <span className="cb-note-from">{theirs ? c.other.username : "You"}:</span> “{c.note}”
        {theirs && state === "idle" && <button className="note-report" onClick={() => setState("ask")} aria-label="Report this note">⚑ Report</button>}
      </div>
      {theirs && state === "ask" ? (
        <div className="note-ask">
          <span>Report this note as harmful?</span>
          <button className="pill" onClick={async () => { const e = await reportNote(c.id); setState(e ?? "sent"); }}>Report</button>
          <button className="pill ghost" onClick={() => setState("idle")}>No</button>
        </div>
      ) : state === "sent" ? (
        <div className="note-tip done">Thanks. We'll take a look.</div>
      ) : state !== "idle" ? (
        <div className="note-tip done">{state}</div>
      ) : theirs ? (
        <div className="note-tip" key={tip}>{NOTE_TIPS[tip]}</div>
      ) : null}
    </div>
  );
}

const SwordsIcon = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2" />
    <path d="M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2" />
  </svg>
);

// Opens the challenge window from anywhere (e.g. the reminder pop-up).
let pendingOpen = false; // asked while Home wasn't on screen: open as soon as it mounts
export const openChallenges = () => { pendingOpen = true; window.dispatchEvent(new Event("pb:open-challenges")); };

// The challenge banner on Home (beside the clan banner). Tap it for the window with both lists.
export function ChallengeButton({ list, now, online, onStart, onBot, onChanged, onPlayer }: {
  list: ChallengeView[]; now: number; online: Player[]; onBot?: (d: BotMatch, mode: ModeId) => void;
  onStart: (p: Player, mode: ModeId) => void; onChanged: () => void; onPlayer: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const theirs = list.filter((c) => !c.mine);
  const mine = list.filter((c) => c.mine);
  const [tab, setTab] = useState<"in" | "out">("in");
  const hot = isHot;
  // looking at the Sent tab clears the "they said yes" ping
  useEffect(() => {
    if (open && tab === "out") markAcceptedSeen(mine.filter((c) => c.justAccepted).map((c) => c.id));
  }, [open, tab, mine.map((c) => c.id + (c.justAccepted ? "y" : "")).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ev = () => { pendingOpen = false; setOpen(true); setTab(list.some((c) => c.mine && hot(c)) && !list.some((c) => !c.mine && hot(c)) ? "out" : "in"); };
    window.addEventListener("pb:open-challenges", ev);
    if (pendingOpen) ev();
    return () => window.removeEventListener("pb:open-challenges", ev);
  }, [list]);
  const ping = list.filter(hot).length;
  const shown = tab === "in" ? theirs : mine;
  return (
    <>
<div className="challenge-flag">
      <button className="clan-banner challenge-banner" onClick={() => { askBadgePermission(); setOpen(true); setTab(theirs.some(hot) || !mine.some(hot) ? "in" : "out"); }} aria-label="Challenges">
        <span className="clan-glyph"><SwordsIcon /></span>
        <span className="clan-banner-text">Challenges</span>
      </button>
        {ping > 0 && <i className="flag-ping">{ping}</i>}
      </div>
      {open && (
        <div className="modal-back sheet-back" onClick={() => setOpen(false)}>
          <div className="follow-sheet challenge-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-top">
              <div className="sheet-title">Challenges</div>
              <button className="sheet-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="seg">
              <button className={tab === "in" ? "on" : ""} onClick={() => setTab("in")}>From others{theirs.length > 0 && ` (${theirs.length})`}{theirs.some(hot) && <i className="seg-ping" />}</button>
              <button className={tab === "out" ? "on" : ""} onClick={() => setTab("out")}>Sent{mine.length > 0 && ` (${mine.length})`}{mine.some(hot) && <i className="seg-ping" />}</button>
            </div>
            <div className="challenge-scroll">
              <ChallengeBox list={shown} now={now} online={online} onChanged={onChanged}
                empty={tab === "in" ? "Nobody has challenged you yet." : "You haven't sent any challenges. Open a player's profile and tap Challenge."}
                onStart={(p, m) => { setOpen(false); onStart(p, m); }} onBot={(d, m) => { setOpen(false); onBot?.(d, m); }} onPlayer={(id) => { setOpen(false); onPlayer(id); }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
