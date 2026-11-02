export type Tab = "home" | "battle" | "throne" | "train" | "clan" | "profile";

type Props = { tab: Tab; onTab: (t: Tab) => void; locked: boolean };

// Bottom navigation: Home, Throne, Train (raised camera button), Clan, Profile.
export default function Dock({ tab, onTab, locked }: Props) {
  const nav = (t: Tab) => () => !locked && onTab(t);
  const on = (...t: Tab[]) => (t.includes(tab) ? "active" : "");
  return (
    <nav className="dock">
      <div className="dock-group">
        <button className={`dock-icon ${on("home", "battle")}`} aria-label="Home" onClick={nav("home")}>
          <svg viewBox="0 0 24 24"><path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z" /></svg>
        </button>
        <button className={`dock-icon ${on("throne")}`} aria-label="Throne" onClick={nav("throne")}>
          <svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" /></svg>
        </button>
      </div>
      <button className={`dock-cam ${on("train")}`} aria-label="Train" onClick={nav("train")}>
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
          <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.6l1.6-2.2h6.6L16.9 7h2.6A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
          <circle cx="12" cy="13" r="3.4" />
        </svg>
      </button>
      <div className="dock-group">
        <button className={`dock-icon ${on("clan")}`} aria-label="Clan" onClick={nav("clan")}>
          <svg viewBox="0 0 24 24"><path d="M6 21V4M6 4h11l-2.5 4L17 12H6" /></svg>
        </button>
        <button className={`dock-icon ${on("profile")}`} aria-label="Profile" onClick={nav("profile")}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
        </button>
      </div>
    </nav>
  );
}
