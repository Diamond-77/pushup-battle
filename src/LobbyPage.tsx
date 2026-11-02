import Avatar from "./Avatar";
import type { Player, PlayerStatus } from "./lobby";

const STATUS_LABEL: Record<PlayerStatus, string> = { idle: "Online", searching: "Looking for a match", in_match: "In a match" };

type Props = {
  players: Player[];
  status: PlayerStatus;
  notice: string | null;
  onChallenge: (p: Player) => void;
  onFindMatch: () => void;
  onCancel: () => void;
};

export default function LobbyPage({ players, status, notice, onChallenge, onFindMatch, onCancel }: Props) {
  return (
    <div className="page dim">
      <div className="brush-title page-title">Battle Lobby</div>
      {status === "searching" ? (
        <button className="game-btn wood wide searching" onClick={onCancel}>
          Searching… tap to cancel
        </button>
      ) : (
        <button className="game-btn jade big wide" onClick={onFindMatch}>
          Find a match
        </button>
      )}
      {notice && <p className="form-msg">{notice}</p>}

      <div className="parchment">
      <div className="section-title">Online now · {players.length}</div>
      {players.length === 0 && <div className="muted">Nobody else is online. Send your friend the link!</div>}
      <ul className="player-list">
        {players.map((p) => (
          <li key={p.id}>
            <Avatar url={p.avatar} color="neutral" size={40} />
            <div className="pl-text">
              <div className="pl-name">{p.name}</div>
              <div className={`pl-status ${p.status}`}>{STATUS_LABEL[p.status]}</div>
            </div>
            <button className="pill" disabled={p.status === "in_match" || status === "in_match"} onClick={() => onChallenge(p)}>
              Challenge
            </button>
          </li>
        ))}
      </ul>
      </div>
    </div>
  );
}
