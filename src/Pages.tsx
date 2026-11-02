import { useState } from "react";
import Avatar from "./Avatar";
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
          <Avatar url={profile.avatar_url} color="me" size={46} />
          <div>
            <div className="plaque-name">{profile.username}</div>
            <div className="respect">
              0 <span className="respect-word">Respect</span>
            </div>
          </div>
        </div>
        <div className="clan-banner" style={clan ? { background: `linear-gradient(180deg, ${clan.color}, #2a1810)` } : undefined}>
          <span className="clan-glyph"><FlagIcon /></span>
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

export function ClanPage({ clan, preview, onPreview }: { clan: ClanState; preview: Clan; onPreview: (c: Clan) => void }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const m = clan.membership;

  if (m) {
    return (
      <div className="page clear">
        <div className="clan-head panel">
          <span className="clan-glyph big" style={{ background: m.clan.color }}><FlagIcon size={32} /></span>
          <div>
            <div className="brush-title">{m.clan.name}</div>
            <div className="muted">{m.clan.motto}</div>
          </div>
        </div>
        <div className="stat-row">
          <span className="stat-chip">{plural(clan.counts[m.clan.id] ?? 1, "member")}</span>
          <span className="stat-chip">{plural(daysLeft(m.expiresAt), "day")} left</span>
        </div>
        <div className="look-hint">Drag to look around · pinch to zoom</div>
        <div className="spacer" />
        {members && (
          <div className="parchment members">
            <div className="section-title">Members · {members.length}</div>
            <ul className="player-list">
              {members.map((p) => (
                <li key={p.id}>
                  <Avatar url={p.avatar} color="neutral" size={36} />
                  <div className="pl-text"><div className="pl-name">{p.name}</div></div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="row stretch">
          <button className="game-btn wood" onClick={async () => setMembers(members ? null : await loadMembers(m.clan.id))}>
            {members ? "Hide members" : "Members"}
          </button>
          <button className="game-btn red" disabled>
            Challenge a clan
          </button>
        </div>
        <div className="soon-strip">Clan wars and chat · coming soon</div>
      </div>
    );
  }

  const join = async () => {
    if (confirming !== preview.id) return setConfirming(preview.id);
    setBusy(true);
    await clan.join(preview.id);
    setBusy(false);
    setConfirming(null);
  };

  return (
    <div className="page clear">
      <div className="panel">
        <div className="brush-title page-title small">Choose your clan</div>
        <div className="muted">Join one clan for {CLAN_DAYS} days, or fight alone as a Lone Warrior.</div>
      </div>
      <div className="clan-tabs">
        {CLANS.map((c) => (
          <button key={c.id} className={c.id === preview.id ? "on" : ""} style={{ ["--accent" as string]: c.color }} onClick={() => { onPreview(c); setConfirming(null); }}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="look-hint">Drag to look around · pinch to zoom</div>
      <div className="spacer" />
      <div className="clan-card panel" style={{ ["--accent" as string]: preview.color }}>
        <div className="clan-card-top">
          <div className="brush-title">{preview.name}</div>
          <span className="stat-chip">{plural(clan.counts[preview.id] ?? 0, "member")}</span>
        </div>
        <div className="muted">{preview.motto}</div>
        <div className="muted small">{WEATHER_LABEL[preview.weather]}</div>
        {clan.error && <p className="form-msg error">{clan.error}</p>}
        <button className={`game-btn ${confirming === preview.id ? "red" : "jade"} wide`} disabled={busy || clan.loading} onClick={join}>
          {busy ? "Joining…" : confirming === preview.id ? `Tap again: join for ${CLAN_DAYS} days` : `Join ${preview.name}`}
        </button>
      </div>
      <div className="lone-strip">
        <b>Lone Warrior</b> · you fight alone until you join a clan
      </div>
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
