import { lazy, Suspense, useEffect, useState } from "react";
import Avatar from "./Avatar";
import ClanLogo from "./ClanLogo";
import type { Profile } from "./auth";
import type { Clan } from "./clans";
const Palace3D = lazy(() => import("./palace/Palace3D"));
import { CONTACT_EMAIL, CONTACT_WHATSAPP, RESPECT_TITLES, START_RESPECT, respectTitle } from "./config";
import Achievements from "./Achievements";
import ArmorFrame, { Blossom, METALS } from "./ArmorFrame";
import SongPlayer from "./SongPlayer";
import { PLAYER_SONGS } from "./config";
import FollowSheet from "./FollowSheet";
import { loadCard, type PlayerCard } from "./stats";
import { SendChallenge } from "./ChallengeUI";
import { challengesChanged } from "./challenges";
import type { ModeId } from "./config";
import { beatInRank, loadHistory, loadProfile, loadSocial, modeName, setFollow, setVote, type HistoryRow, type Social } from "./social";

export const ThumbUp = ({ down = false }: { down?: boolean }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={down ? { transform: "scaleY(-1)" } : undefined}>
    <path d="M7 11v9H4v-9h3zM7 11l4-8c1.7 0 2.6 1 2.3 2.6L12.8 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7" />
  </svg>
);

const WHEN = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" })
  + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// Last battles: me vs them with both pictures, who won, the score and the date.
export function HistoryList({ rows, me, onPlayer }: { rows: HistoryRow[] | null; me?: Profile; onPlayer?: (id: string) => void }) {
  return (
    <div className="parchment">
      <div className="section-title">Last battles</div>
      {rows === null && <div className="muted">Loading…</div>}
      {rows?.length === 0 && <div className="muted">No battles yet.</div>}
      <ul className="history vs-history">
        {rows?.map((r) => (
          <li key={r.id} className={r.result}>
            <div className="vs-top">
              <span className="h-result">{r.result === "win" ? "Won" : r.result === "lose" ? "Lost" : r.result === "draw" ? "Draw" : "…"}</span>
              <span className="vs-when">{modeName(r.mode)} · {WHEN(r.when)}</span>
              <b className={r.delta < 0 ? "minus" : "gold-text"}>{r.delta > 0 ? "+" : ""}{r.delta}</b>
            </div>
            <div className="vs-row">
              <div className="vs-side">
                <Avatar url={me?.avatar_url ?? null} color="me" size={44} legendary={me?.legendary} />
                <span>{me?.username ?? "Me"}</span>
              </div>
              <div className="vs-score">
                <b className={r.result === "win" ? "hi" : ""}>{r.myReps ?? "–"}</b>
                <i>VS</i>
                <b className={r.result === "lose" ? "hi" : ""}>{r.oppReps ?? "–"}</b>
              </div>
              <button className="vs-side" onClick={() => onPlayer?.(r.oppId)} disabled={!onPlayer}>
                <Avatar url={r.oppAvatar} color="opp" size={44} legendary={r.oppLegendary} />
                <span>{r.opponent}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Bug reports go straight to the developer. Only shown on the developer's (legendary) profile.
export function ReportPanel() {
  return (
    <div className="panel report">
      <div className="section-title">Found a bug? Message the developer</div>
      <div className="row stretch">
        <a className="game-btn jade whatsapp" href={`https://wa.me/${CONTACT_WHATSAPP}?text=${encodeURIComponent("Hi! Pushup Battle bug: ")}`} target="_blank" rel="noreferrer">
          WhatsApp
        </a>
        <a className="game-btn wood" href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Pushup Battle bug")}`}>
          Email
        </a>
      </div>
    </div>
  );
}

export const ordinal = (n: number) => {
  const t = n % 100, u = n % 10;
  return n + (t >= 11 && t <= 13 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th");
};

// Each clan's colour on the profile card (lone warriors get steel).
const ACCENT: Record<string, string> = Object.fromEntries(Object.entries(METALS).map(([k, m]) => [k, m.glow]));
const LONE_ACCENT = METALS.lone.glow;

// How far through the current Respect title, toward the next one.
function titleProgress(respect: number) {
  let i = 0;
  RESPECT_TITLES.forEach(([min], k) => { if (respect >= min) i = k; });
  const [min] = RESPECT_TITLES[i];
  const next = RESPECT_TITLES[i + 1];
  if (!next) return { pct: 100, next: null as string | null, left: 0 };
  return { pct: Math.round(((respect - min) / (next[0] - min)) * 100), next: next[1], left: next[0] - respect };
}

const LoneMark = ({ size = 30 }: { size?: number }) => (
  <svg viewBox="0 0 48 52" width={size} height={size * 1.08} aria-hidden="true">
    <path d="M24 1 46 13v26L24 51 2 39V13z" fill="#2b3340" stroke="#0b0d10" strokeWidth="2.5" />
    <path d="M24 10v26M18 30h12M24 36v6" stroke="#dfe7f0" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

// A player's profile, as a full page. On your own profile it has an Edit button instead of Back.
export default function PlayerPage({ id, myId, onBack, onEdit, onPlayer }: { id: string; myId: string; onBack?: () => void; onEdit?: () => void; onPlayer?: (id: string) => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [clan, setClan] = useState<Clan | null>(null);
  const [s, setS] = useState<Social | null>(null);
  const [hist, setHist] = useState<HistoryRow[] | null>(null);
  const [card, setCard] = useState<PlayerCard | null>(null);
  const [tab, setTab] = useState<"achievements" | "history">("achievements");
  const [sheet, setSheet] = useState<"followers" | "following" | null>(null);
  const [tease, setTease] = useState(false); // "beat them in Rank first" popup
  const [challenge, setChallenge] = useState<ModeId | "any" | null>(null);
  const [sent, setSent] = useState(false);
  const mine = id === myId;

  useEffect(() => {
    setP(null); setCard(null); setSheet(null);
    loadProfile(id).then((r) => { setP(r.profile); setClan(r.clan); });
    loadSocial(id, myId).then(setS);
    loadHistory(id).then(setHist);
    loadCard(id).then(setCard);
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
    if (next === -1 && !(await beatInRank(myId, id))) return setTease(true);
    setS({
      ...s,
      myVote: next,
      likes: s.likes - (s.myVote === 1 ? 1 : 0) + (next === 1 ? 1 : 0),
      dislikes: s.dislikes - (s.myVote === -1 ? 1 : 0) + (next === -1 ? 1 : 0),
    });
    await setVote(myId, id, next);
  };
  const respect = p?.respect ?? START_RESPECT;
  const prog = titleProgress(respect);
  const accent = clan ? ACCENT[clan.id] ?? clan.color : LONE_ACCENT;
  const metal = METALS[clan?.id ?? "lone"] ?? METALS.lone;

  return (
    <div className={`page sub-page pv2 ${clan ? `theme-${clan.id}` : "theme-lone"}`} style={{ ["--acc" as string]: accent }}>
      {clan && (
        <div className="pv2-scene" aria-hidden="true">
          <Suspense fallback={null}>
            <Palace3D seed={clan.name} weather={clan.weather} style={clan.palace} zoom={1.65} still />
          </Suspense>
          <div className="theme-fx" />
          <div className="pv2-fade" />
        </div>
      )}
      <div className="row page-top">
        {onBack ? <button className="back-btn" onClick={onBack}>‹ Back</button> : <div className="brush-title page-title">Profile</div>}
        {onEdit && <button className="back-btn" onClick={onEdit}>Edit profile</button>}
      </div>
      {!p ? (
        <div className="muted txt-center">Loading…</div>
      ) : (
        <>
          <ArmorFrame clan={clan?.id ?? "lone"} className={PLAYER_SONGS[p.username]?.profile ? "assemble" : ""}>
          {PLAYER_SONGS[p.username]?.profile && <SongPlayer song={PLAYER_SONGS[p.username].profile!} color={accent} className="profile-song" />}
          <div className={`pcard ${p.legendary ? "dev" : ""}`}>
            <Blossom color={accent} />
            <div className="pcard-side">
              {clan ? <ClanLogo clan={clan} size={32} /> : <LoneMark size={32} />}
              <div className="pcard-clan">{clan ? clan.name : "Lone Warrior"}</div>
            </div>
            <div className="pcard-main">
              <div className="pcard-head">
                <Avatar url={p.avatar_url} color="neutral" size={88} legendary={p.legendary} glow={accent} />
                <div className="pcard-id">
                  <div className="brush-title pcard-name">{p.username}</div>
                  {p.title && <div className="dev-badge">{p.title}</div>}
                  <div className="pcard-respect"><b>{respect}</b> Respect</div>
                  <div className="rmeter" title={prog.next ? `${prog.left} to ${prog.next}` : "Highest title"}>
                    <div className="rmeter-fill" style={{ width: `${Math.max(4, prog.pct)}%` }} />
                    {[25, 50, 75].map((x) => <i key={x} style={{ left: `${x}%` }} />)}
                  </div>
                  <div className="rmeter-note">{prog.next ? <>{prog.left} to <b>{prog.next}</b></> : "Highest title reached"}</div>
                </div>
              </div>
              <div className="pcard-counts">
                <button onClick={() => setSheet("followers")}><b>{s?.followers ?? "–"}</b><span>Followers</span></button>
                <i />
                <button onClick={() => setSheet("following")}><b>{s?.following ?? "–"}</b><span>Following</span></button>
              </div>
              {p.bio && <p className="pcard-bio">{p.bio}</p>}
              {!mine && (
                <button className="game-btn red challenge-btn" onClick={() => setChallenge("any")}>{sent ? "Challenge sent ✓" : "Challenge"}</button>
              )}
              <div className="pcard-actions">
                {!mine && (
                  <button className={`game-btn ${s?.iFollow ? "wood" : "jade"}`} disabled={!s} onClick={follow}>
                    {s?.iFollow ? "Following" : "Follow"}
                  </button>
                )}
                <button className={`vote-btn ${s?.myVote === 1 ? "on" : ""}`} disabled={!s || mine} onClick={() => vote(1)} aria-label="Like">
                  <ThumbUp /> {s?.likes ?? 0}
                </button>
                <button className={`vote-btn down ${s?.myVote === -1 ? "on" : ""}`} disabled={!s || mine} onClick={() => vote(-1)} aria-label="Dislike">
                  <ThumbUp down /> {s?.dislikes ?? 0}
                </button>
              </div>
            </div>
          </div>
          </ArmorFrame>
          <div className="rank-pill">
            <span><b>{respect}</b> Respect · {respectTitle(respect)}</span>
            {card && card.throne_rank > 0 && (
              <span className="rank-places">
                {clan && card.clan_rank > 0 && <>{ordinal(card.clan_rank)} {clan.name} · </>}{ordinal(card.throne_rank)} Throne
              </span>
            )}
          </div>
          {p.legendary && <ReportPanel />}
          <div className="seg pv2-tabs">
            <button className={tab === "achievements" ? "on" : ""} onClick={() => setTab("achievements")}>Achievements</button>
            <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History</button>
          </div>
          {tab === "achievements" ? <Achievements card={card} accent={accent} dark={metal.dark} mid={metal.mid} name={p.username} id={id} /> : <HistoryList rows={hist} me={p} onPlayer={onPlayer} />}
          {sheet && (
            <FollowSheet id={id} name={p.username} start={sheet} counts={{ followers: s?.followers ?? 0, following: s?.following ?? 0 }}
              onClose={() => setSheet(null)} onPlayer={onPlayer ? (pid) => { setSheet(null); onPlayer(pid); } : undefined} />
          )}
          {challenge && (
            <SendChallenge id={id} name={p.username} avatar={p.avatar_url} mode={challenge === "any" ? undefined : challenge}
              onClose={() => setChallenge(null)} onSent={() => { setSent(true); challengesChanged(); }} />
          )}
          {tease && (
            <div className="modal-back" onClick={() => setTease(false)}>
              <div className="modal panel tease" onClick={(e) => e.stopPropagation()}>
                <Avatar url={p.avatar_url} color="opp" size={80} legendary={p.legendary} />
                <div className="modal-title">Whoa, someone doesn't like {p.username}!</div>
                <p className="modal-text">Words are cheap. Defeat <b>{p.username}</b> in a <b>Rank</b> match, then you've earned the right to dislike them.</p>
                <button className="game-btn red" onClick={() => { setTease(false); setChallenge("rank"); }}>Challenge accepted</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
