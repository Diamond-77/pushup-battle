import { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";
import ClanLogo from "./ClanLogo";
import { clanById } from "./clans";
import type { Player, PlayerStatus } from "./lobby";
import { FIELDS, MODES, TRAINING_CAP, respectTitle, type FieldId, type ModeId } from "./config";

const STATUS_LABEL: Record<PlayerStatus, string> = { idle: "Online", searching: "Looking for a match", in_match: "In a match" };

type Props = {
  players: Player[];
  status: PlayerStatus;
  notice: string | null;
  onChallenge: (p: Player, mode: ModeId) => void;
  onFindMatch: (mode: ModeId) => void;
  onCancel: () => void;
  field: FieldId;
  onField: (f: FieldId) => void;
  respect: number;
  onTrain: () => void;
  onPlayer: (id: string) => void;
};

// Pictures of each battlefield for the cards (rendered once, in the 3D chunk).
function useShots() {
  const [shots, setShots] = useState<Partial<Record<FieldId, string>>>({});
  useEffect(() => {
    let stop = false;
    (async () => {
      const { arenaShot } = await import("./palace/arenaShots");
      for (const f of FIELDS) {
        if (stop) return;
        await new Promise((r) => setTimeout(r, 60)); // let the page breathe between renders
        try {
          const url = await arenaShot(f.id, f.weather);
          if (!stop) setShots((s) => ({ ...s, [f.id]: url }));
        } catch { /* no WebGL: cards keep their painted color */ }
      }
    })();
    return () => { stop = true; };
  }, []);
  return shots;
}

export default function LobbyPage({ players, status, notice, onChallenge, onFindMatch, onCancel, field, onField, respect, onTrain, onPlayer }: Props) {
  const shots = useShots();
  const trackRef = useRef<HTMLDivElement>(null);
  const isMode = field !== "training";
  const M = isMode ? MODES[field as ModeId] : null;
  const canPlay = !M || respect >= M.minRespect;
  const shown = players.filter((p) => p.status !== "searching" || p.mode === field);

  // Swipe: whichever card is closest to the middle is the selected battlefield.
  const onScroll = () => {
    const el = trackRef.current;
    if (!el || status === "searching") return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = field, dist = Infinity;
    Array.from(el.children).forEach((card, i) => {
      const c = card as HTMLElement;
      const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
      if (d < dist) { dist = d; best = FIELDS[i].id; }
    });
    if (best !== field) onField(best);
  };
  const goTo = (id: FieldId) => {
    const el = trackRef.current;
    const i = FIELDS.findIndex((f) => f.id === id);
    const card = el?.children[i] as HTMLElement | undefined;
    if (el && card) el.scrollTo({ left: card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2, behavior: "smooth" });
  };
  useEffect(() => {
    // open on the selected card without animating
    const el = trackRef.current;
    const card = el?.children[FIELDS.findIndex((f) => f.id === field)] as HTMLElement | undefined;
    if (el && card) el.scrollLeft = card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page clear lobby-page">
      <div className="brush-title page-title">Battlefield</div>
      <div className="field-track" ref={trackRef} onScroll={onScroll}>
        {FIELDS.map((f) => {
          const mode = f.id !== "training" ? MODES[f.id as ModeId] : null;
          const locked = !!mode && respect < mode.minRespect;
          return (
            <button key={f.id} className={`field-card ${f.id} ${f.id === field ? "on" : ""} ${locked ? "locked" : ""}`} onClick={() => goTo(f.id)}
              style={shots[f.id] ? { backgroundImage: `url(${shots[f.id]})` } : undefined}>
              <div className="field-shade" />
              {locked && <div className="field-lock">Needs {mode!.minRespect} Respect</div>}
              <div className="field-info">
                <div className="field-place">{f.place}</div>
                <div className="field-name">{mode ? mode.name : "Training"}</div>
                <div className="field-meta">
                  {mode ? <>{mode.seconds / 60} min · <b>bet {mode.bet}</b></> : <>Up to {TRAINING_CAP} Respect a day</>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="guide-dots">
        {FIELDS.map((f) => <span key={f.id} className={f.id === field ? "on" : ""} />)}
      </div>

      <div className="lobby-bottom">
        <div className="muted small mode-blurb">{M ? M.blurb : "Timed push-up challenges. Earn up to 50 Respect every 24 hours."}</div>
        {!isMode ? (
          <button className="game-btn jade big wide" onClick={onTrain}>Enter training</button>
        ) : !canPlay ? (
          <div className="panel broke">
            <div>You need <b>{M!.minRespect} Respect</b> for {M!.name}. You have {respect}.</div>
            <button className="game-btn jade wide" onClick={onTrain}>Train to earn Respect</button>
          </div>
        ) : status === "searching" ? (
          <button className="game-btn wood wide searching" onClick={onCancel}>
            Searching {M!.name}… tap to cancel
          </button>
        ) : (
          <button className="game-btn red big wide" onClick={() => onFindMatch(field as ModeId)}>
            Find a {M!.name} match
          </button>
        )}
        {notice && <p className="form-msg">{notice}</p>}

        {isMode && (
          <div className="parchment">
            <div className="section-title">Online now · {shown.length}</div>
            {shown.length === 0 && <div className="muted">Nobody else is online. Send your friend the link!</div>}
            <ul className="player-list">
              {shown.map((p) => (
                <li key={p.id}>
                  <button className="member-row shrink" onClick={() => onPlayer(p.id)} aria-label={`Open ${p.name}'s profile`}>
                    <Avatar url={p.avatar} color="neutral" size={40} legendary={p.legendary} />
                  </button>
                  {clanById(p.clan) && <ClanLogo clan={clanById(p.clan)!} size={22} />}
                  <div className="pl-text">
                    <div className="pl-name">
                      {p.name}
                      {p.title && <span className="title-badge">{p.title}</span>}
                    </div>
                    <div className={`pl-status ${p.status}`}>
                      {p.status === "searching" && p.mode ? `Looking for ${MODES[p.mode].name}` : STATUS_LABEL[p.status]}
                      {p.respect !== undefined && <span className="pl-respect"> · {p.respect} · {respectTitle(p.respect)}</span>}
                    </div>
                  </div>
                  <button className="pill" disabled={p.status === "in_match" || status === "in_match" || !canPlay || (p.respect !== undefined && p.respect < M!.minRespect)} onClick={() => onChallenge(p, field as ModeId)}>
                    Challenge
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
