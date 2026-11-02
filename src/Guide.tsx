import { useState, type ReactNode } from "react";

// First-time guide: how to get the green border. Slide by slide, no skip button.
const KEY = "pb_guide_done_v1";
export const guideDone = () => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
};

type Slide = { title: string; text: string; pic: ReactNode };

const Phone = ({ border }: { border: "green" | "red" | "flash" }) => (
  <div className={`guide-phone ${border}`}>
    <svg viewBox="0 0 120 70" width="100%" height="100%">
      <rect x="0" y="58" width="120" height="12" fill="#3a2418" />
      {/* side-view plank stickman */}
      <g stroke="#ff7a1a" strokeWidth="3" strokeLinecap="round" fill="none">
        <path d="M30 34 L92 46" />
        <path d="M34 35 L34 58" />
        <path d="M92 46 L100 58" />
      </g>
      <circle cx="22" cy="31" r="6" fill="none" stroke="#fff" strokeWidth="2.5" />
    </svg>
  </div>
);

const SLIDES: Slide[] = [
  {
    title: "Phone on the floor",
    text: "Stand your phone up on the floor, about 1.5 metres to your side. The camera must see you from the side.",
    pic: (
      <svg viewBox="0 0 120 70" width="100%" height="100%">
        <rect x="0" y="58" width="120" height="12" fill="#3a2418" />
        <rect x="8" y="30" width="16" height="28" rx="3" fill="#24140d" stroke="#e8b84a" strokeWidth="2" />
        <circle cx="16" cy="36" r="2.5" fill="#3fbf8a" />
        <path d="M28 44 L50 38 M28 44 L50 50" stroke="#e8b84a" strokeWidth="1.5" strokeDasharray="3 3" />
        <g stroke="#ff7a1a" strokeWidth="3" strokeLinecap="round"><path d="M62 40 L108 48 M65 41 L65 58 M108 48 L114 58" /></g>
        <circle cx="56" cy="38" r="5" fill="none" stroke="#fff" strokeWidth="2.5" />
      </svg>
    ),
  },
  {
    title: "Whole body in the picture",
    text: "Get into push-up position. Head, hands, hips and feet must all be inside the picture.",
    pic: <Phone border="red" />,
  },
  {
    title: "Green border = ready",
    text: "When the screen border turns green, the game can see you. Red means: move back, get your whole body in, or lift your knees off the floor.",
    pic: <Phone border="green" />,
  },
  {
    title: "Go down, come up",
    text: "Lower your chest until the meter on the right is full, then push all the way up. A bright flash means the rep counted.",
    pic: <Phone border="flash" />,
  },
  {
    title: "Fair fight",
    text: "In a battle the game locks onto the player who started. If someone else takes over, the screen turns red and the battle pauses.",
    pic: (
      <div className="guide-phone red lock">
        <span>Switching body</span>
      </div>
    ),
  },
];

export default function Guide({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;
  const s = SLIDES[i];
  const next = () => {
    if (!last) return setI(i + 1);
    try { localStorage.setItem(KEY, "1"); } catch { /* private mode: show again next time */ }
    onDone();
  };
  return (
    <div className="guide-back">
      <div className="guide panel">
        <div className="guide-step">How to play · {i + 1} / {SLIDES.length}</div>
        <div className="guide-pic">{s.pic}</div>
        <div className="brush-title guide-title">{s.title}</div>
        <p className="guide-text">{s.text}</p>
        <div className="guide-dots">
          {SLIDES.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}
        </div>
        <div className="row stretch">
          {i > 0 && <button className="game-btn wood" onClick={() => setI(i - 1)}>Back</button>}
          <button className="game-btn jade" onClick={next}>{last ? "I'm ready" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
