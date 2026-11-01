// Hexagon avatar: the player's picture, or a silhouette when they have none.
export default function Avatar({ url, color, size = 38 }: { url?: string | null; color: "me" | "opp" | "neutral"; size?: number }) {
  return (
    <div className={`hex ${color}`} style={{ width: size, height: size * 1.1 }}>
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
}
