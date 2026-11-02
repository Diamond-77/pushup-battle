import Avatar from "./Avatar";
import type { Profile } from "./auth";

// Full-page screens drawn over the 3D palace.

const FlagIcon = ({ size = 26 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 21V4M6 4h11l-2.5 4L17 12H6" />
  </svg>
);

export function HomePage({ profile, onBattle, onTrain }: { profile: Profile; onBattle: () => void; onTrain: () => void }) {
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
        <div className="clan-banner">
          <span className="clan-glyph"><FlagIcon /></span>
          <span className="clan-banner-text">No clan yet</span>
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

export function ClanPage() {
  return (
    <div className="page clear">
      <div className="clan-head panel">
        <span className="clan-glyph big"><FlagIcon size={32} /></span>
        <div>
          <div className="brush-title">Your Sect</div>
          <div className="muted">Clans are coming soon. This is a preview of a clan palace.</div>
        </div>
      </div>
      <div className="look-hint">Drag to look around · pinch to zoom</div>
      <div className="spacer" />
      <div className="row stretch">
        <button className="game-btn wood" disabled>
          Members
        </button>
        <button className="game-btn red" disabled>
          Challenge a clan
        </button>
      </div>
      <div className="soon-strip">Clan chat · coming soon</div>
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
