import { useState } from "react";
import Avatar from "./Avatar";
import ClanLogo from "./ClanLogo";
import { CLANS, type Clan } from "./clans";
import { CLAN_DAYS } from "./config";
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
              0 <span className="respect-word">Respect</span>
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
                {p.title && <div className="title-badge">{p.title}</div>}
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
        </div>
        <div className="look-hint">Drag to look around · pinch to zoom</div>
        <div className="spacer" />
        {overlays}
        <div className="row stretch">
          {membersBtn}
          <button className="game-btn red" disabled>
            Challenge a clan
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
      <div className="panel">
        <div className="brush-title page-title small">{m ? "Rival clans" : "Choose your clan"}</div>
        <div className="muted">{m ? `You fight for ${m.clan.name}. Scout the other empires.` : "Pick a clan, or fight alone as a Lone Warrior."}</div>
      </div>
      <div className="look-hint">Drag to look around · pinch to zoom</div>
      <div className="spacer" />
      {overlays}
      <div className="clan-card panel" style={{ ["--accent" as string]: preview.color }}>
        <div className="clan-card-top">
          <ClanLogo clan={preview} size={40} />
          <div className="brush-title grow">{preview.name}</div>
          <span className="stat-chip">{plural(clan.counts[preview.id] ?? 0, "member")}</span>
        </div>
        <div className="muted">{preview.motto}</div>
        <div className="muted small">{WEATHER_LABEL[preview.weather]}</div>
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

export function ThronePage() {
  return (
    <div className="page dim">
      <div className="brush-title page-title">Throne</div>
      <div className="throne-seat">
        <div className="throne-label">THE THRONE</div>
        <div className="throne-empty">?</div>
        <div className="throne-holder">Unclaimed</div>
      </div>
      <div className="panel soon-panel">
        <div className="soon-badge">Coming soon</div>
        <p>The best fighter sits on the throne, everyone else stands on the floor below. Win battles, earn Respect and snatch it.</p>
      </div>
    </div>
  );
}
