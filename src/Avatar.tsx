// Hexagon avatar: the player's picture, or a silhouette when they have none.
export default function Avatar({ url, color, size = 38, legendary }: { url?: string | null; color: "me" | "opp" | "neutral"; size?: number; legendary?: boolean }) {
  const hex = (
    <div className={`hex ${color} ${legendary ? "legendary" : ""}`} style={{ width: size, height: size * 1.1 }}>
      <div className="hex-inner">
        {url ? (
          <img src={url} alt="" className="hex-img" />
        ) : (
          <svg viewBox="0 0 40 40" width="100%" height="100%">
            <circle cx="20" cy="15" r="7" fill="#8a8f98" />
            <path d="M6 40c0-9 6.3-14 14-14s14 5 14 14z" fill="#8a8f98" />
          </svg>
        )}
      </div>
    </div>
  );
  if (!legendary) return hex;
  // Legendary (developer only): glowing halo, shimmering frame and sparks orbiting the avatar
  return (
    <div className="legend-wrap" style={{ width: size, height: size * 1.1, ["--s" as string]: `${size}px` }}>
      <div className="legend-halo" />
      {hex}
      <div className="legend-orbit">{[0, 1, 2, 3].map((i) => <i key={i} style={{ ["--i" as string]: i }} />)}</div>
    </div>
  );
}
