import Avatar from "./Avatar";
import ClanLogo from "./ClanLogo";
import { clanById } from "./clans";
import type { Player, PlayerStatus } from "./lobby";
import { MODES, respectTitle, type ModeId } from "./config";

const STATUS_LABEL: Record<PlayerStatus, string> = { idle: "Online", searching: "Looking for a match", in_match: "In a match" };

type Props = {
  players: Player[];
  status: PlayerStatus;
  notice: string | null;
  onChallenge: (p: Player, mode: ModeId) => void;
  onFindMatch: (mode: ModeId) => void;
  onCancel: () => void;
  mode: ModeId;
  onMode: (m: ModeId) => void;
  respect: number;
  onTrain: () => void;
};

export default function LobbyPage({ players, status, notice, onChallenge, onFindMatch, onCancel, mode, onMode, respect, onTrain }: Props) {
  const M = MODES[mode];
  const canPlay = respect >= M.minRespect;
  const shown = players.filter((p) => p.status !== "searching" || p.mode === mode);
  return (
    <div className="page dim">
      <div className="brush-title page-title">Battle Lobby</div>
      <div className="mode-pick">
        {(Object.keys(MODES) as ModeId[]).map((id) => (
          <button key={id} className={`${id === mode ? "on" : ""} ${respect < MODES[id].minRespect ? "locked" : ""}`} disabled={status === "searching"} onClick={() => onMode(id)}>
            <b>{MODES[id].name}</b>
            <span>{MODES[id].seconds / 60} min · bet {MODES[id].bet}</span>
          </button>
        ))}
      </div>
      <div className="muted small mode-blurb">{M.blurb}</div>
      {!canPlay ? (
        <div className="panel broke">
          <div>You need <b>{M.minRespect} Respect</b> for {M.name}. You have {respect}.</div>
          <button className="game-btn jade wide" onClick={onTrain}>Train to earn Respect</button>
        </div>
      ) : status === "searching" ? (
        <button className="game-btn wood wide searching" onClick={onCancel}>
          Searching {M.name}… tap to cancel
        </button>
      ) : (
        <button className="game-btn jade big wide" onClick={() => onFindMatch(mode)}>
          Find a {M.name} match
        </button>
      )}
      {notice && <p className="form-msg">{notice}</p>}

      <div className="parchment">
      <div className="section-title">Online now · {players.length}</div>
      {players.length === 0 && <div className="muted">Nobody else is online. Send your friend the link!</div>}
      <ul className="player-list">
        {shown.map((p) => (
          <li key={p.id}>
            <Avatar url={p.avatar} color="neutral" size={40} legendary={p.legendary} />
            {clanById(p.clan) && <ClanLogo clan={clanById(p.clan)!} size={22} />}
            <div className="pl-text">
              <div className="pl-name">
                {p.name}
                {p.title && <span className="title-badge">{p.title}</span>}
              </div>
              <div className={`pl-status ${p.status}`}>
                {p.status === "searching" && p.mode ? `Looking for ${MODES[p.mode].name}` : STATUS_LABEL[p.status]}
                {p.respect !== undefined && <span className="pl-respect"> · {p.respect} Respect · {respectTitle(p.respect)}</span>}
              </div>
            </div>
            <button className="pill" disabled={p.status === "in_match" || status === "in_match" || !canPlay || (p.respect !== undefined && p.respect < M.minRespect)} onClick={() => onChallenge(p, mode)}>
              Challenge
            </button>
          </li>
        ))}
      </ul>
      </div>
    </div>
  );
}
