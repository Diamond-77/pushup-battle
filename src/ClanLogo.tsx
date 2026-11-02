import type { Clan } from "./clans";

// Each clan's emblem: Arasaka a lightning bolt, Soraran Gate a sun rising over a gate,
// sleepBuilders a crescent moon over a hammer. Drawn as SVG so it stays sharp at any size.
export default function ClanLogo({ clan, size = 40 }: { clan: Clan; size?: number }) {
  return (
    <svg viewBox="0 0 48 52" width={size} height={size * 1.08} className="clan-logo" aria-label={clan.name}>
      <path d="M24 1 46 13v26L24 51 2 39V13z" fill={clan.color} stroke="#1b1a1f" strokeWidth="2.5" />
      <path d="M24 6 41 15.5v21L24 46 7 36.5v-21z" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      {clan.id === "arasaka" && <path d="M27 9 14 29h9l-4 15 15-22h-9l4-13z" fill="#fff4e6" stroke="#1b1a1f" strokeWidth="1.5" strokeLinejoin="round" />}
      {clan.id === "soraran-gate" && (
        <g stroke="#1b1a1f" strokeWidth="1.5" strokeLinejoin="round">
          <circle cx="24" cy="22" r="7" fill="#fff4e6" />
          <path d="M11 28h26l-2 3H13z M15 31v12 M33 31v12 M10 34h28" fill="#7a2a1c" />
        </g>
      )}
      {clan.id === "sleepbuilders" && (
        <g stroke="#1b1a1f" strokeWidth="1.5" strokeLinejoin="round">
          <path d="M28 9a10 10 0 1 0 7 17 8 8 0 1 1-7-17z" fill="#fff4e6" />
          <path d="M16 33h12v5H16z M21 38h2.5v8H21z" fill="#e8b84a" />
        </g>
      )}
    </svg>
  );
}
