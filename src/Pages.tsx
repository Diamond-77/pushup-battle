import Avatar from "./Avatar";
import type { Profile } from "./auth";

// Full-page screens with their own background. Placeholders until the new design arrives.

export function HomePage({ profile, onBattle, onTrain }: { profile: Profile; onBattle: () => void; onTrain: () => void }) {
  return (
    <div className="page home-page">
      <div className="home-top">
        <Avatar url={profile.avatar_url} color="me" size={52} />
        <div>
          <div className="pl-name">{profile.username}</div>
          <div className="respect">0 Respect</div>
        </div>
      </div>
      {/* Space for an event / news banner later */}
      <div className="banner-slot" />
      <div className="home-title">PUSHUP BATTLE</div>
      <div className="home-actions">
        <button className="big-btn" onClick={onBattle}>Battle</button>
        <button className="big-btn small ghost-btn" onClick={onTrain}>Train</button>
      </div>
    </div>
  );
}

export function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <div className="page">
      <h2>{title}</h2>
      <div className="soon-card">
        <div className="soon-badge">Coming soon</div>
        <p>{text}</p>
      </div>
    </div>
  );
}
