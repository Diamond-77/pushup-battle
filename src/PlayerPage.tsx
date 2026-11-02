import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import ClanLogo from "./ClanLogo";
import type { Profile } from "./auth";
import type { Clan } from "./clans";
import { START_RESPECT, respectTitle } from "./config";
import { loadHistory, loadProfile, loadSocial, modeName, setFollow, setVote, type HistoryRow, type Social } from "./social";

export const ThumbUp = ({ down = false }: { down?: boolean }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={down ? { transform: "scaleY(-1)" } : undefined}>
    <path d="M7 11v9H4v-9h3zM7 11l4-8c1.7 0 2.6 1 2.3 2.6L12.8 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7" />
  </svg>
);

export function HistoryList({ rows }: { rows: HistoryRow[] | null }) {
  return (
    <div className="parchment">
      <div className="section-title">Last battles</div>
      {rows === null && <div className="muted">Loading…</div>}
      {rows?.length === 0 && <div className="muted">No battles yet.</div>}
      <ul className="history">
        {rows?.map((r) => (
          <li key={r.id} className={r.result}>
            <span className="h-result">{r.result === "win" ? "Won" : r.result === "lose" ? "Lost" : r.result === "draw" ? "Draw" : "…"}</span>
            <div className="pl-text">
              <div className="pl-name">vs {r.opponent}</div>
              <div className="pl-status">{modeName(r.mode)} · {r.myReps ?? "–"}–{r.oppReps ?? "–"} · {r.when.toLocaleDateString()}</div>
            </div>
            <b className={r.delta < 0 ? "minus" : "gold-text"}>{r.delta > 0 ? "+" : ""}{r.delta}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SocialRow({ s, mine, onFollow, onVote }: { s: Social | null; mine: boolean; onFollow?: () => void; onVote?: (v: 1 | -1) => void }) {
  return (
    <div className="social-row">
      <div className="social-counts">
        <span><b>{s?.followers ?? "–"}</b> followers</span>
        <span><b>{s?.following ?? "–"}</b> following</span>
      </div>
      <div className="row stretch">
        {!mine && (
          <button className={`game-btn ${s?.iFollow ? "wood" : "jade"}`} disabled={!s} onClick={onFollow}>
            {s?.iFollow ? "Following" : "Follow"}
          </button>
        )}
        <button className={`vote-btn ${s?.myVote === 1 ? "on" : ""}`} disabled={!s || mine} onClick={() => onVote?.(1)} aria-label="Like">
          <ThumbUp /> {s?.likes ?? 0}
        </button>
        <button className={`vote-btn down ${s?.myVote === -1 ? "on" : ""}`} disabled={!s || mine} onClick={() => onVote?.(-1)} aria-label="Dislike">
          <ThumbUp down /> {s?.dislikes ?? 0}
        </button>
      </div>
    </div>
  );
}

// Another player's profile, as a full page.
export default function PlayerPage({ id, myId, onBack }: { id: string; myId: string; onBack: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [clan, setClan] = useState<Clan | null>(null);
  const [s, setS] = useState<Social | null>(null);
  const [hist, setHist] = useState<HistoryRow[] | null>(null);
  const mine = id === myId;

  useEffect(() => {
    loadProfile(id).then((r) => { setP(r.profile); setClan(r.clan); });
    loadSocial(id, myId).then(setS);
    loadHistory(id).then(setHist);
  }, [id, myId]);

  const follow = async () => {
    if (!s) return;
    const on = !s.iFollow;
    setS({ ...s, iFollow: on, followers: s.followers + (on ? 1 : -1) });
    await setFollow(myId, id, on);
  };
  const vote = async (v: 1 | -1) => {
    if (!s) return;
    const next = s.myVote === v ? 0 : v;
    setS({
      ...s,
      myVote: next,
      likes: s.likes - (s.myVote === 1 ? 1 : 0) + (next === 1 ? 1 : 0),
      dislikes: s.dislikes - (s.myVote === -1 ? 1 : 0) + (next === -1 ? 1 : 0),
    });
    await setVote(myId, id, next);
  };
  const respect = p?.respect ?? START_RESPECT;

  return (
    <div className="page dim sub-page">
      <button className="back-btn" onClick={onBack}>‹ Back</button>
      {!p ? (
        <div className="muted txt-center">Loading…</div>
      ) : (
        <>
          <div className={`profile-hero ${p.legendary ? "legendary-card" : ""}`}>
            <Avatar url={p.avatar_url} color="neutral" size={104} legendary={p.legendary} />
            <div className="brush-title profile-name">{p.username}</div>
            {p.title && <div className="title-badge big">{p.legendary ? "Legendary · " : ""}{p.title}</div>}
            <div className="respect">{respect} <span className="respect-word">Respect</span> <span className="rank-title">{respectTitle(respect)}</span></div>
            <div className="clan-chip">
              {clan ? <><ClanLogo clan={clan} size={30} /><div><b>{clan.name}</b></div></> : <div><b>Lone Warrior</b></div>}
            </div>
            {p.bio && <p className="bio">{p.bio}</p>}
          </div>
          <SocialRow s={s} mine={mine} onFollow={follow} onVote={vote} />
          <HistoryList rows={hist} />
        </>
      )}
    </div>
  );
}
