import { lazy, Suspense, useMemo, useState } from "react";
import type { PlayerCard } from "./stats";

const Scroll3D = lazy(() => import("./palace/Scroll3D"));

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK = ["M", "T", "W", "T", "F", "S", "S"];
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const Flame = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3-1-3 0-6 1-9.5z" fill="#ff8a3d" />
    <path d="M12 12c.5 2 2.5 2.6 2.5 4.6a2.5 2.5 0 0 1-5 0c0-1 .5-1.8 1-2.3.2 1 .7 1.3 1.1 1.3-.3-1.3 0-2.6.4-3.6z" fill="#ffd27a" />
  </svg>
);

// A month of dots: orange for days with push-ups, dim for missed days, hollow for days still to come.
export function StreakCalendar({ card }: { card: PlayerCard }) {
  const [ty, tm, td] = card.today.split("-").map(Number);
  const [back, setBack] = useState(0); // 0 = this month, 1 = last month
  const y = tm - 1 - back < 0 ? ty - 1 : ty;
  const m = (tm - 1 - back + 12) % 12;
  const byDay = useMemo(() => new Map(card.recent.map((r) => [r.day, r.reps])), [card.recent]);
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Monday first
  const todayKey = iso(ty, tm - 1, td);
  const active = Array.from({ length: days }, (_, i) => byDay.get(iso(y, m, i + 1)) ?? 0).filter((r) => r > 0).length;
  const most = Math.max(1, ...card.recent.map((r) => r.reps));

  return (
    <div className="streak-card">
      <div className="streak-head">
        <div>
          <div className="streak-label">Active days in {MONTHS[m]}</div>
          <div className="streak-big">{active} <span>{active === 1 ? "day" : "days"}</span></div>
        </div>
        <div className="streak-now">
          <Flame />
          <b>{card.streak}</b>
          <span>day streak</span>
        </div>
      </div>
      <div className="streak-grid">
        {WEEK.map((d, i) => <div key={i} className="streak-wd">{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const k = iso(y, m, i + 1);
          const reps = byDay.get(k) ?? 0;
          const future = k > todayKey;
          const cls = reps > 0 ? "on" : future ? "future" : "off";
          const glow = reps > 0 ? 0.55 + 0.45 * Math.min(1, reps / most) : 0;
          return (
            <div key={k} className={`streak-dot ${cls} ${k === todayKey ? "today" : ""}`} style={{ ["--i" as string]: lead + i, ...(reps ? { opacity: glow } : {}) }} title={`${i + 1} ${MONTHS[m]}: ${reps} push-ups`} />
          );
        })}
      </div>
      <div className="streak-foot">
        <button className="streak-nav" disabled={back === 1} onClick={() => setBack(1)}>‹ {MONTHS[(tm - 2 + 12) % 12].slice(0, 3)}</button>
        <span>Best streak <b>{card.best_streak}</b></span>
        <button className="streak-nav" disabled={back === 0} onClick={() => setBack(0)}>{MONTHS[tm - 1].slice(0, 3)} ›</button>
      </div>
    </div>
  );
}

const BADGES: { id: string; mark: string; name: string; got: (c: PlayerCard) => boolean }[] = [
  { id: "win1", mark: "1", name: "First victory", got: (c) => c.wins >= 1 },
  { id: "c100", mark: "100", name: "Century", got: (c) => c.total >= 100 },
  { id: "c1k", mark: "1K", name: "Thousand fists", got: (c) => c.total >= 1000 },
  { id: "c10k", mark: "10K", name: "Ten thousand", got: (c) => c.total >= 10000 },
  { id: "s7", mark: "7", name: "Week of fire", got: (c) => c.best_streak >= 7 },
  { id: "s30", mark: "30", name: "Month of fire", got: (c) => c.best_streak >= 30 },
  { id: "w25", mark: "25", name: "Warlord", got: (c) => c.wins >= 25 },
  { id: "b50", mark: "50", name: "50 in a battle", got: (c) => c.best_battle >= 50 },
];

// The Achievements tab: the scroll with lifetime push-ups, the streak month, wins and bests, badges.
export default function Achievements({ card, accent, name }: { card: PlayerCard | null; accent: string; name: string }) {
  const [open, setOpen] = useState(false);
  const c = card;
  return (
    <div className="achv">
      <Suspense fallback={<div className="scroll3d" style={{ height: 150 }} />}>
        <Scroll3D total={c?.total ?? 0} accent={accent} name={name} open={open} onToggle={() => setOpen((o) => !o)} />
      </Suspense>
      {open && c && (
        <div className="achv-reveal">
          <StreakCalendar card={c} />
          <div className="stat-tiles">
            <div className="stat-tile"><b>{c.wins}</b><span>Wins</span><em>{c.battles} battles</em></div>
            <div className="stat-tile"><b>{c.best_battle}</b><span>Personal best</span><em>in one battle</em></div>
            <div className="stat-tile"><b>{c.best_day}</b><span>Best day</span><em>{c.active_days} active days</em></div>
          </div>
        </div>
      )}
      <div className="badge-grid">
        {BADGES.map((b) => {
          const got = !!c && b.got(c);
          return (
            <div key={b.id} className={`badge ${got ? "got" : ""}`}>
              <div className="badge-hex">{b.mark}</div>
              <span>{b.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
