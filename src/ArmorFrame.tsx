import type { ReactNode } from "react";

// Samurai-armour frame round the profile card, different for every clan:
// a crest on top, shoulder plates on the corners and a braided cord knotted at the bottom.

export type Metal = { dark: string; mid: string; glow: string; cord: string };
export const METALS: Record<string, Metal> = {
  arasaka: { dark: "#1c1b20", mid: "#6b2420", glow: "#e0453a", cord: "#b8281f" },
  "soraran-gate": { dark: "#2a1a10", mid: "#9a5a1e", glow: "#f2a541", cord: "#d9822b" },
  sleepbuilders: { dark: "#1a1428", mid: "#55358f", glow: "#a98bff", cord: "#7b55d6" },
  lone: { dark: "#1c2026", mid: "#525c68", glow: "#9fb3c8", cord: "#6d7a88" },
};

const INK = "#08080a";

function Defs({ id, m }: { id: string; m: Metal }) {
  return (
    <defs>
      <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={m.mid} />
        <stop offset="0.45" stopColor={m.dark} />
        <stop offset="0.8" stopColor={m.mid} />
        <stop offset="1" stopColor={m.dark} />
      </linearGradient>
      <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
        <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id={`${id}-orb`} cx="0.4" cy="0.35" r="0.7">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
        <stop offset="0.35" stopColor={m.glow} />
        <stop offset="1" stopColor={m.dark} />
      </radialGradient>
    </defs>
  );
}

// a gold engraved swirl, like the dragons hammered into the reference armour
const Swirl = ({ x, y, s = 1, c }: { x: number; y: number; s?: number; c: string }) => (
  <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 0c4-6 12-6 13 0s-6 8-9 4 1-6 4-3M13 0c3 5 10 5 12 0" fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" opacity="0.75" />
);

export function Crest({ clan, m }: { clan: string; m: Metal }) {
  const id = `cr-${clan}`;
  const metal = `url(#${id}-metal)`;
  const horns = (jag: boolean) => (
    <>
      {[1, -1].map((s) => (
        <g key={s} transform={s < 0 ? "translate(240 0) scale(-1 1)" : undefined}>
          <path
            d={jag
              ? "M112 70 C86 62 58 44 30 4 L42 20 L46 10 L58 30 L64 20 C78 38 96 44 116 50 Z"
              : "M112 70 C84 64 50 46 24 2 C54 26 88 38 118 48 Z"}
            fill={metal} stroke={INK} strokeWidth="2.5" strokeLinejoin="round"
          />
          <path d={jag ? "M106 58 C84 50 62 34 40 12" : "M106 58 C80 50 56 34 34 12"} fill="none" stroke={m.glow} strokeWidth="1.5" opacity="0.7" />
          <Swirl x={70} y={40} s={0.9} c="#d9b26a" />
        </g>
      ))}
    </>
  );
  return (
    <svg className="crest" viewBox="0 0 240 96" aria-hidden="true">
      <Defs id={id} m={m} />
      {clan === "arasaka" && horns(true)}
      {clan === "sleepbuilders" && horns(false)}
      {clan === "soraran-gate" && (
        <g>
          <g stroke={m.glow} strokeWidth="3" opacity="0.6">
            {Array.from({ length: 11 }, (_, i) => {
              const a = Math.PI * (0.05 + (i / 10) * 0.9);
              return <line key={i} x1={120 - Math.cos(a) * 36} y1={52 - Math.sin(a) * 36} x2={120 - Math.cos(a) * 56} y2={52 - Math.sin(a) * 56} />;
            })}
          </g>
          <circle cx="120" cy="52" r="30" fill={`url(#${id}-orb)`} stroke={INK} strokeWidth="2.5" />
          <path d="M28 50 Q120 36 212 50 L208 62 Q120 50 32 62 Z" fill={metal} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M50 70 H190 V78 H50 Z" fill={metal} stroke={INK} strokeWidth="2.5" />
          <path d="M66 60 V96 M174 60 V96" stroke={INK} strokeWidth="11" />
          <path d="M66 60 V96 M174 60 V96" stroke={m.mid} strokeWidth="7" />
        </g>
      )}
      {clan === "lone" && (
        <g>
          <path d="M120 6 L128 60 L120 70 L112 60 Z" fill={metal} stroke={INK} strokeWidth="2.5" />
          <path d="M92 62 H148" stroke={INK} strokeWidth="8" strokeLinecap="round" />
          <path d="M92 62 H148" stroke={m.mid} strokeWidth="4" strokeLinecap="round" />
        </g>
      )}
      {clan !== "soraran-gate" && (
        <g>
          <path d="M92 86 Q92 56 120 54 Q148 56 148 86 Z" fill={metal} stroke={INK} strokeWidth="2.5" />
          {[100, 110, 120, 130, 140].map((x) => <path key={x} d={`M${x} 60 V86`} stroke={INK} strokeWidth="1.2" opacity="0.6" />)}
          <circle cx="120" cy="74" r="12" fill={`url(#${id}-orb)`} stroke={INK} strokeWidth="2.5" />
          {clan === "arasaka" && <path d="M122 65 115 76h5l-2 7 8-11h-5l2-7z" fill="#fff4e6" />}
          {clan === "sleepbuilders" && <path d="M123 66a8 8 0 1 0 5 13 6 6 0 1 1-5-13z" fill="#fff4e6" />}
          {clan === "lone" && <circle cx="120" cy="74" r="3" fill="#fff4e6" />}
        </g>
      )}
    </svg>
  );
}

// shoulder plate: three overlapping lames with rivets
export function Pauldron({ clan, m, right }: { clan: string; m: Metal; right?: boolean }) {
  const id = `pd-${clan}-${right ? "r" : "l"}`;
  const lames = [
    "M4 14 Q34 0 66 10 L64 46 Q34 36 6 50 Z",
    "M8 46 Q34 34 62 44 L58 76 Q34 68 10 80 Z",
    "M12 78 Q34 68 56 76 L52 104 Q34 98 14 108 Z",
  ];
  return (
    <svg className={`pauldron ${right ? "right" : "left"}`} viewBox="0 0 70 112" aria-hidden="true">
      <Defs id={id} m={m} />
      {lames.map((d, i) => (
        <g key={i}>
          <path d={d} fill={`url(#${id}-metal)`} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
          <path d={d} fill={`url(#${id}-shine)`} />
        </g>
      ))}
      <path d="M10 18 Q34 6 60 15" fill="none" stroke={m.glow} strokeWidth="1.4" opacity="0.8" />
      <Swirl x={20} y={26} s={1.3} c="#d9b26a" />
      {[[12, 40], [58, 36], [16, 72], [54, 68], [20, 101], [48, 97]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.4" fill="#d9b26a" stroke={INK} strokeWidth="1" />
      ))}
    </svg>
  );
}

// braided cord tied in a knot with two tassels
export function Knot({ m }: { m: Metal }) {
  const braid = (d: string) => (
    <>
      <path d={d} fill="none" stroke={INK} strokeWidth="9" strokeLinecap="round" />
      <path d={d} fill="none" stroke={m.cord} strokeWidth="6" strokeLinecap="round" />
      <path d={d} fill="none" stroke="#e7c27a" strokeWidth="6" strokeDasharray="3 5" />
    </>
  );
  return (
    <svg className="knot" viewBox="0 0 220 70" aria-hidden="true">
      {braid("M4 16 Q56 30 98 22")}
      {braid("M216 16 Q164 30 122 22")}
      {braid("M98 22 q-14 -14 2 -16 q10 0 10 16 q0 -16 10 -16 q16 2 2 16")}
      <circle cx="110" cy="24" r="8" fill={m.cord} stroke={INK} strokeWidth="2.5" />
      <circle cx="110" cy="24" r="3" fill="#e7c27a" />
      {[-7, 7].map((dx) => (
        <g key={dx} transform={`translate(${110 + dx} 30) rotate(${dx > 0 ? -6 : 6})`}>
          <path d="M-3 0 h6 v6 h-6z" fill="#e7c27a" stroke={INK} strokeWidth="1.5" />
          <path d="M-3 6 L-6 36 H6 L3 6 Z" fill={m.cord} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M-3 12 L-4 34 M0 12 V34 M3 12 L4 34" stroke="#e7c27a" strokeWidth="0.8" opacity="0.8" />
        </g>
      ))}
    </svg>
  );
}

// a faint blossom branch painted inside the card
export const Blossom = ({ color }: { color: string }) => (
  <svg className="blossom" viewBox="0 0 120 160" aria-hidden="true">
    <path d="M118 2 C96 30 92 60 70 84 C56 100 52 120 40 150 M92 52 C78 50 66 40 58 30 M76 92 C90 98 100 112 104 126" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    {[[60, 30], [82, 64], [100, 124], [46, 132], [104, 30], [70, 104]].map(([x, y], i) => (
      <g key={i} transform={`translate(${x} ${y})`} fill={color}>
        {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="0" cy="-6" rx="4" ry="6" transform={`rotate(${a})`} />)}
        <circle r="2.2" fill="#000" opacity="0.4" />
      </g>
    ))}
  </svg>
);

// Arasaka only: lightning running round the frame, strikes across the card, embers rising.
const EMBERS = Array.from({ length: 16 }, (_, i) => ({ x: (i * 37) % 100, d: 3 + ((i * 7) % 5), delay: -((i * 13) % 50) / 10, s: 2 + (i % 3) }));
function ArasakaFx() {
  return (
    <div className="ara-fx" aria-hidden="true">
      <div className="ara-run" />
      <div className="ara-run two" />
      <svg className="ara-bolt" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points="72,0 60,22 68,26 50,50 58,54 38,78 46,80 30,100" />
      </svg>
      <svg className="ara-bolt b2" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points="18,0 28,18 20,24 34,46 26,50 40,72" />
      </svg>
      <div className="ara-flash" />
      {EMBERS.map((e, i) => (
        <i key={i} className="ember" style={{ left: `${e.x}%`, width: e.s, height: e.s, animationDuration: `${e.d}s`, animationDelay: `${e.delay}s` }} />
      ))}
    </div>
  );
}

export default function ArmorFrame({ clan, children }: { clan: string; children: ReactNode }) {
  const m = METALS[clan] ?? METALS.lone;
  return (
    <div className={`armor armor-${clan}`} style={{ ["--m-dark" as string]: m.dark, ["--m-mid" as string]: m.mid, ["--m-glow" as string]: m.glow }}>
      <Crest clan={clan} m={m} />
      <Pauldron clan={clan} m={m} />
      <Pauldron clan={clan} m={m} right />
      {clan === "arasaka" && <ArasakaFx />}
      {children}
      <Knot m={m} />
    </div>
  );
}

// Sode: a tall samurai sleeve guard of laced lames, standing at each side of the throne.
export function SideGuard({ clan, right }: { clan: string; right?: boolean }) {
  const m = METALS[clan] ?? METALS.lone;
  const id = `sg-${clan}-${right ? "r" : "l"}`;
  const rows = 7;
  return (
    <svg className={`side-guard ${right ? "right" : "left"}`} viewBox="0 0 54 300" preserveAspectRatio="none" aria-hidden="true">
      <Defs id={id} m={m} />
      {/* the cord the lames hang from */}
      <path d="M8 6 H46" stroke={m.cord} strokeWidth="6" strokeLinecap="round" />
      {Array.from({ length: rows }, (_, i) => {
        const y = 10 + i * 40;
        const d = `M4 ${y} Q27 ${y - 5} 50 ${y} L48 ${y + 40} Q27 ${y + 35} 6 ${y + 40} Z`;
        return (
          <g key={i}>
            <path d={d} fill={`url(#${id}-metal)`} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
            <path d={d} fill={`url(#${id}-shine)`} />
            {/* lacing */}
            {[14, 27, 40].map((x) => <path key={x} d={`M${x} ${y + 4} v32`} stroke={m.cord} strokeWidth="2.4" strokeDasharray="4 3" />)}
            <path d={`M6 ${y + 37} Q27 ${y + 32} 48 ${y + 37}`} fill="none" stroke={m.glow} strokeWidth="1.2" opacity="0.7" />
          </g>
        );
      })}
      <Swirl x={14} y={150} s={1.1} c="#d9b26a" />
    </svg>
  );
}
