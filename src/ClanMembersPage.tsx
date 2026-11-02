import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import ClanLogo from "./ClanLogo";
import type { Clan } from "./clans";
import { respectTitle } from "./config";
import { loadMembers, type Member } from "./useClan";

// Clan members as a pyramid: the most Respect sits alone at the top as the clan's
// representative, then 2, 3, 4… per row. Positions change as Respect changes, and the
// bottom row always keeps open seats for new members.
const OPEN_SEATS = 3;

export default function ClanMembersPage({ clan, onBack, onPlayer }: { clan: Clan; onBack: () => void; onPlayer: (id: string) => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [view, setView] = useState<"tree" | "list">("tree");
  useEffect(() => {
    loadMembers(clan.id).then((m) => setMembers([...m].sort((a, b) => (b.respect ?? 0) - (a.respect ?? 0))));
  }, [clan.id]);

  // rows of 1, 2, 3, … filled in Respect order, plus open seats
  const rows: (Member | null)[][] = [];
  if (members) {
    const seats: (Member | null)[] = [...members, ...Array(OPEN_SEATS).fill(null)];
    for (let size = 1, i = 0; i < seats.length; size++) {
      rows.push(seats.slice(i, i + size));
      i += size;
    }
    const last = rows[rows.length - 1];
    while (last.length < rows.length) last.push(null);
  }
  const total = members?.reduce((s, m) => s + (m.respect ?? 0), 0) ?? 0;

  return (
    <div className="page dim sub-page">
      <button className="back-btn" onClick={onBack}>‹ Back</button>
      <div className="clan-head panel" style={{ ["--accent" as string]: clan.color }}>
        <ClanLogo clan={clan} size={50} />
        <div>
          <div className="brush-title">{clan.name}</div>
          <div className="muted">{members ? `${members.length} members · ${total} clan Respect` : "Loading…"}</div>
        </div>
      </div>
      <div className="seg">
        <button className={view === "tree" ? "on" : ""} onClick={() => setView("tree")}>Rank tree</button>
        <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>List</button>
      </div>

      {members && view === "tree" && (
        <div className="pyramid" style={{ ["--accent" as string]: clan.color }}>
          {rows.map((row, r) => (
            <div key={r} className="pyr-row">
              {row.map((m, k) =>
                m ? (
                  <button key={m.id} className={`pyr-seat ${r === 0 ? "top" : ""}`} onClick={() => onPlayer(m.id)}>
                    {r === 0 && <span className="pyr-crown">Representative</span>}
                    <Avatar url={m.avatar} color={r === 0 ? "me" : "neutral"} size={r === 0 ? 72 : r < 3 ? 50 : 40} legendary={m.legendary} />
                    <span className="pyr-name">{m.name}</span>
                    <span className="pyr-respect">{m.respect ?? 0}</span>
                  </button>
                ) : (
                  <div key={`open${k}`} className="pyr-seat open">
                    <div className="pyr-empty">+</div>
                    <span className="pyr-name">Open seat</span>
                  </div>
                ),
              )}
            </div>
          ))}
          <p className="muted small txt-center">Earn Respect to climb. Pass someone above you and you take their seat.</p>
        </div>
      )}

      {members && view === "list" && (
        <div className="parchment">
          <ol className="rank-list">
            {members.map((m, i) => (
              <li key={m.id}>
                <span className="rank-no">{i + 1}</span>
                <button className="member-row" onClick={() => onPlayer(m.id)}>
                  <Avatar url={m.avatar} color="neutral" size={34} legendary={m.legendary} />
                  <div className="pl-text">
                    <div className="pl-name">{m.name}</div>
                    <div className="pl-status">{i === 0 ? "Representative · " : ""}{respectTitle(m.respect ?? 0)}</div>
                  </div>
                </button>
                <b className="gold-text">{m.respect ?? 0}</b>
              </li>
            ))}
          </ol>
          {members.length === 0 && <div className="muted">Nobody yet. Be the first.</div>}
        </div>
      )}
    </div>
  );
}
