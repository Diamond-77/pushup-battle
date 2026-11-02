import Avatar from "./Avatar";
import ClanLogo from "./ClanLogo";
import { CLANS, type Clan } from "./clans";
import { CLAN_DAYS, START_RESPECT, respectTitle } from "./config";
import { supabase } from "./supabase";
import { useEffect, useState } from "react";
import { daysLeft, loadMembers, type Member, type useClan } from "./useClan";
import type { Profile } from "./auth";

// Full-page screens drawn over the 3D palace.

const FlagIcon = ({ size = 26 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 21V4M6 4h11l-2.5 4L17 12H6" />
  </svg>
);

export function HomePage({ profile, clan, onBattle, onTrain }: { profile: Profile; clan: Clan | null; onBattle: () => void; onTrain: () => void }) {
  return (
    <div className="page home-page clear">
      <div className="home-top">
        <div className="plaque">
          <Avatar url={profile.avatar_url} color="me" size={46} legendary={profile.legendary} />
          <div>
            <div className="plaque-name">{profile.username}</div>
            {profile.title && <div className="title-badge">{profile.title}</div>}
            <div className="respect">
              {profile.respect ?? START_RESPECT} <span className="respect-word">Respect</span>
              <span className="rank-title">{respectTitle(profile.respect ?? START_RESPECT)}</span>
            </div>
          </div>
        </div>
        <div className="clan-banner" style={clan ? { background: `linear-gradient(180deg, ${clan.color}, #2a1810)` } : undefined}>
          <span className="clan-glyph">{clan ? <ClanLogo clan={clan} size={34} /> : <FlagIcon />}</span>
          <span className="clan-banner-text">{clan ? clan.name : "Lone warrior"}</span>
        </div>
      </div>
      {/* Space for an event / news banner later */}
      <div className="banner-slot">Event banner · reserved</div>
      <div className="spacer" />
      <div className="home-actions">
        <button className="game-btn red big" onClick={onBattle}>
          Battle
        </button>
        <button className="game-btn jade" onClick={onTrain}>
          Train
        </button>
      </div>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const WEATHER_LABEL = { storm: "Storm and lightning", sunset: "Golden sunset", night: "Moonlit night", day: "Clear day" };

type ClanState = ReturnType<typeof useClan>;

// Anyone can see who is in any clan, and tap a member to see their profile.
function MembersPanel({ members, onPick }: { members: Member[]; onPick: (m: Member) => void }) {
  return (
    <div className="parchment members">
      <div className="section-title">Members · {members.length}</div>
      {members.length === 0 && <div className="muted">Nobody yet. Be the first.</div>}
      <ul className="player-list">
        {members.map((p) => (
          <li key={p.id}>
            <button className="member-row" onClick={() => onPick(p)}>
              <Avatar url={p.avatar} color="neutral" size={36} legendary={p.legendary} />
              <div className="pl-text">
                <div className="pl-name">{p.name}</div>
                <div className="pl-status">
                  {p.title && <span className="title-badge">{p.title}</span>}
                  {p.respect !== null && <> {p.respect} Respect · {respectTitle(p.respect)}</>}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MemberModal({ member, clan, onClose }: { member: Member; clan: Clan; onClose: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal panel ${member.legendary ? "legendary-card" : ""}`} onClick={(e) => e.stopPropagation()}>
        <Avatar url={member.avatar} color="neutral" size={88} legendary={member.legendary} />
        <div className="modal-title">{member.name}</div>
        {member.title && <div className="title-badge big">{member.legendary ? "Legendary · " : ""}{member.title}</div>}
        {member.respect !== null && <div className="respect">{member.respect} <span className="respect-word">Respect</span> <span className="rank-title">{respectTitle(member.respect)}</span></div>}
        <div className="clan-chip">
          <ClanLogo clan={clan} size={30} />
          <div><b>{clan.name}</b><span>member since {member.joinedAt.toLocaleDateString()}</span></div>
        </div>
        <button className="game-btn wood" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function ClanPage({ clan, preview, onPreview }: { clan: ClanState; preview: Clan; onPreview: (c: Clan) => void }) {
  const [popup, setPopup] = useState<"join" | "locked" | null>(null);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [picked, setPicked] = useState<Member | null>(null);
  const m = clan.membership;
  const mine = m?.clan.id === preview.id;
  const tabs = (
    <div className="clan-tabs">
      {CLANS.map((c) => (
        <button key={c.id} className={c.id === preview.id ? "on" : ""} style={{ ["--accent" as string]: c.color }} onClick={() => { onPreview(c); setPopup(null); setMembers(null); }}>
          {c.name}
        </button>
      ))}
    </div>
  );
  const toggleMembers = async () => setMembers(members ? null : await loadMembers(preview.id));
  const membersBtn = (
    <button className="game-btn wood" onClick={toggleMembers}>
      {members ? "Hide members" : "Members"}
    </button>
  );
  const overlays = (
    <>
      {members && <MembersPanel members={members} onPick={setPicked} />}
      {picked && <MemberModal member={picked} clan={preview} onClose={() => setPicked(null)} />}
    </>
  );

  // Your own clan
  if (m && mine) {
    return (
      <div className="page clear">
        {tabs}
        <div className="clan-head panel">
          <ClanLogo clan={m.clan} size={58} />
          <div>
            <div className="brush-title">{m.clan.name}</div>
            <div className="muted">{m.clan.motto}</div>
          </div>
        </div>
        <div className="stat-row">
          <span className="stat-chip">{plural(clan.counts[m.clan.id] ?? 1, "member")}</span>
          <span className="stat-chip gold">{clan.respect[m.clan.id] ?? 0} Respect</span>
        </div>
        <div className="look-hint">Drag to look around · pinch to zoom</div>
        <div className="spacer" />
        {overlays}
        <div className="row stretch">
          {membersBtn}
          <button className="game-btn red" disabled>
            Clan war
          </button>
        </div>
        <div className="soon-strip">Clan wars and chat · coming soon</div>
      </div>
    );
  }

  const join = async () => {
    setBusy(true);
    await clan.join(preview.id);
    setBusy(false);
    setPopup(null);
  };

  return (
    <div className="page clear">
      {tabs}
      <div className="look-hint">{m ? `Scouting a rival empire` : "Choose your clan"} · drag to look around</div>
      <div className="spacer" />
      {overlays}
      <div className="clan-card panel" style={{ ["--accent" as string]: preview.color }}>
        <div className="clan-card-top">
          <ClanLogo clan={preview} size={40} />
          <div className="brush-title grow">{preview.name}</div>
          <span className="stat-chip">{plural(clan.counts[preview.id] ?? 0, "member")}</span>
        </div>
        <div className="muted small"><b className="gold-text">{clan.respect[preview.id] ?? 0} clan Respect</b></div>
        <div className="muted">{preview.motto} <span className="small">· {WEATHER_LABEL[preview.weather]}</span></div>
        {clan.error && <p className="form-msg error">{clan.error}</p>}
        <div className="row stretch">
          {membersBtn}
          <button className="game-btn jade" disabled={busy || clan.loading} onClick={() => setPopup(m ? "locked" : "join")}>
            {m ? "Switch clan" : `Join ${preview.name}`}
          </button>
        </div>
      </div>
      {!m && (
        <div className="lone-strip">
          <b>Lone Warrior</b> · you fight alone until you join a clan
        </div>
      )}

      {popup && (
        <div className="modal-back" onClick={() => !busy && setPopup(null)}>
          <div className="modal panel" onClick={(e) => e.stopPropagation()}>
            <ClanLogo clan={popup === "locked" ? m!.clan : preview} size={64} />
            {popup === "join" ? (
              <>
                <div className="modal-title">Join {preview.name}?</div>
                <p className="modal-text">
                  Once you join, you are sworn to {preview.name} for <b>{CLAN_DAYS} days</b>. You can't leave or switch clans until then.
                </p>
                <div className="row stretch">
                  <button className="game-btn wood" disabled={busy} onClick={() => setPopup(null)}>Not now</button>
                  <button className="game-btn jade" disabled={busy} onClick={join}>{busy ? "Joining…" : "Join"}</button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-title">Still sworn to {m!.clan.name}</div>
                <p className="modal-text">
                  Your oath lasts {CLAN_DAYS} days. You can switch to {preview.name} in <b>{plural(daysLeft(m!.expiresAt), "day")}</b>.
                </p>
                <button className="game-btn wood" onClick={() => setPopup(null)}>OK</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type Ranked = { id: string; username: string; avatar_url: string | null; respect: number; title?: string | null; legendary?: boolean };

// The throne: the player with the most Respect sits on it. Clans are ranked by their members' total.
export function ThronePage({ clanRespect, myId }: { clanRespect: Record<string, number>; myId: string }) {
  const [view, setView] = useState<"players" | "clans">("players");
  const [top, setTop] = useState<Ranked[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    supabase?.from("profiles").select("*").order("respect", { ascending: false }).limit(30)
      .then(({ data, error }) => (error ? setFailed(true) : setTop((data ?? []) as Ranked[])));
  }, []);
  const king = top?.[0];
  const clans = [...CLANS].sort((a, b) => (clanRespect[b.id] ?? 0) - (clanRespect[a.id] ?? 0));
  return (
    <div className="page dim">
      <div className="brush-title page-title">Throne</div>
      <div className="seg">
        <button className={view === "players" ? "on" : ""} onClick={() => setView("players")}>Warriors</button>
        <button className={view === "clans" ? "on" : ""} onClick={() => setView("clans")}>Clans</button>
      </div>
      {view === "players" ? (
        <>
          <div className="throne-seat">
            <div className="throne-label">THE THRONE</div>
            {king ? <Avatar url={king.avatar_url} color="me" size={84} legendary={king.legendary} /> : <div className="throne-empty">?</div>}
            <div className="throne-holder">{king ? king.username : failed ? "Respect isn't set up yet" : "…"}</div>
            {king && <div className="respect">{king.respect} <span className="respect-word">Respect</span> <span className="rank-title">{respectTitle(king.respect)}</span></div>}
          </div>
          <div className="parchment">
            <ol className="rank-list">
              {(top ?? []).slice(1).map((p, i) => (
                <li key={p.id} className={p.id === myId ? "me" : ""}>
                  <span className="rank-no">{i + 2}</span>
                  <Avatar url={p.avatar_url} color="neutral" size={34} legendary={p.legendary} />
                  <div className="pl-text">
                    <div className="pl-name">{p.username}</div>
                    <div className="pl-status">{respectTitle(p.respect)}</div>
                  </div>
                  <b className="gold-text">{p.respect}</b>
                </li>
              ))}
            </ol>
            {top && top.length <= 1 && <div className="muted">Win battles to stand in line for the throne.</div>}
          </div>
        </>
      ) : (
        <div className="parchment">
          <ol className="rank-list">
            {clans.map((c, i) => (
              <li key={c.id}>
                <span className="rank-no">{i + 1}</span>
                <ClanLogo clan={c} size={34} />
                <div className="pl-text"><div className="pl-name">{c.name}</div></div>
                <b className="gold-text">{clanRespect[c.id] ?? 0}</b>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
