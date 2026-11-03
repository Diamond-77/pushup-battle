import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import { respectTitle } from "./config";
import { loadFollowList, type FollowPerson } from "./stats";

// A big popup listing a player's followers or the players they follow.
export default function FollowSheet({ id, name, start, counts, onClose, onPlayer }: {
  id: string; name: string; start: "followers" | "following"; counts: { followers: number; following: number };
  onClose: () => void; onPlayer?: (id: string) => void;
}) {
  const [kind, setKind] = useState(start);
  const [list, setList] = useState<FollowPerson[] | null>(null);
  useEffect(() => {
    setList(null);
    loadFollowList(id, kind).then(setList);
  }, [id, kind]);

  return (
    <div className="modal-back sheet-back" onClick={onClose}>
      <div className="follow-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-top">
          <div className="sheet-title">{name}</div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="seg">
          <button className={kind === "followers" ? "on" : ""} onClick={() => setKind("followers")}>{counts.followers} Followers</button>
          <button className={kind === "following" ? "on" : ""} onClick={() => setKind("following")}>{counts.following} Following</button>
        </div>
        <ul className="sheet-list">
          {list === null && <li className="muted">Loading…</li>}
          {list?.length === 0 && <li className="muted">{kind === "followers" ? "No followers yet." : "Not following anyone yet."}</li>}
          {list?.map((p) => (
            <li key={p.id}>
              <button onClick={() => onPlayer?.(p.id)}>
                <Avatar url={p.avatar_url} color="neutral" size={46} legendary={p.legendary} />
                <div className="pl-text">
                  <div className="pl-name">{p.username}{p.title && <span className="title-badge">{p.title}</span>}</div>
                  <div className="pl-status">{p.respect} Respect · {respectTitle(p.respect ?? 0)}</div>
                </div>
                <span className="sheet-go">›</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
