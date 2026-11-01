export type Tab = "home" | "friends" | "profile";

type Props = { tab: Tab; onTab: (t: Tab) => void; onFlip: () => void; locked: boolean };

// Bottom navigation. The middle button flips the camera. Leaderboard is a placeholder for later.
export default function Dock({ tab, onTab, onFlip, locked }: Props) {
  const nav = (t: Tab) => () => !locked && onTab(t);
  return (
    <nav className="dock">
      <div className="dock-group">
        <button className={`dock-icon ${tab === "home" ? "active" : ""}`} aria-label="Home" onClick={nav("home")}>
          <svg viewBox="0 0 24 24"><path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z" /></svg>
        </button>
        <button className="dock-icon soon" aria-label="Leaderboard (coming soon)">
          <svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" /></svg>
        </button>
      </div>
      <button className="dock-cam" aria-label="Flip camera" onClick={onFlip}>
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
          <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.6l1.6-2.2h6.6L16.9 7h2.6A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
          <path d="M9.2 12.2a3 3 0 0 1 5.3-1.2M14.8 13.8a3 3 0 0 1-5.3 1.2M14.6 9.6v1.6H13M9.4 16.4v-1.6H11" />
        </svg>
      </button>
      <div className="dock-group">
        <button className={`dock-icon ${tab === "friends" ? "active" : ""}`} aria-label="Friends" onClick={nav("friends")}>
          <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.4c2 .8 3.5 2.8 3.5 5.6" /></svg>
        </button>
        <button className={`dock-icon ${tab === "profile" ? "active" : ""}`} aria-label="Profile" onClick={nav("profile")}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
        </button>
      </div>
    </nav>
  );
}
