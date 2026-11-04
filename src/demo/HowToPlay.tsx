import { useEffect, useRef, useState } from "react";
import { Stage, type Shot } from "./stage";
import { drawStickman } from "../pose";
import { METER_SEGMENTS, MODES } from "../config";
import Hud from "../Hud";

// Full-page how-to-play: a 3D park guy shows each step inside the app's own camera
// screen (green/red border, orange tracking lines, depth meter), then wins a demo battle.
// Every step plays a while before Next unlocks (no skipping); Back goes to the step before.

import { HOWTO_KEY } from "./done";

type Border = "ok" | "bad" | "switch" | "none";
type UI = {
  border: Border;
  flash?: boolean;
  meter?: number;
  skeleton?: "me" | "intruder" | null;
  reps?: number;
  check?: boolean;
  warn?: boolean;
  dist?: boolean;
  hint?: string;
  battle?: { my: number; opp: number; secs: number; phase: "setup" | "count" | "match" | "result"; count?: number };
};
type Frame = { shot: Shot; ui: UI };
type Step = { title: string; text: string; unlock: number; loop?: number; frame: (t: number) => Frame };

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t: number) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const ramp = (t: number, from: number, len: number) => ease((t - from) / len);

// push-ups that finish exactly at the given times
function reps(times: number[], t: number, start = 0) {
  let prev = start, n = 0;
  for (const rt of times) {
    if (t < rt) {
      const ph = (t - prev) / (rt - prev);
      return { depth: (1 - Math.cos(ph * Math.PI * 2)) / 2, n, flash: n > 0 && t - prev < 0.2 };
    }
    prev = rt;
    n++;
  }
  return { depth: 0.04 + 0.03 * Math.sin(t * 2), n, flash: n > 0 && t - prev < 0.2 };
}
const idle = (t: number) => 0.03 + 0.03 * Math.sin(t * 2.2);

// the demo battle (seconds after "GO")
const MATCH_LEN = 20;
const MY_REPS = [...Array.from({ length: 6 }, (_, i) => 1.35 * (i + 1)), ...Array.from({ length: 11 }, (_, i) => 8.1 + 1.05 * (i + 1))];
const OPP_REPS = [0.6, 1.3, 2.0, 2.7, 3.5, 4.4, 5.6, 7.0, 8.8, 11, 13.5, 16.5];
const SETUP = 3.6, COUNT = 3, GO = SETUP + COUNT;
const countBefore = (list: number[], t: number) => list.filter((x) => x <= t).length;

const STEPS: Step[] = [
  {
    title: "Phone on the floor",
    text: "Stand your phone up on the floor, about 2 metres (6.5 ft) in front of you, screen facing you.",
    unlock: 5,
    loop: 9,
    frame: (t) => {
      const pv = ramp(t, 2.8, 1.8);
      return {
        shot: { phoneView: pv, me: { depth: idle(t) }, phone: clamp(t / 0.5), ruler: ramp(t, 0.5, 1.3) },
        ui: { border: pv >= 1 ? "ok" : "none", skeleton: pv >= 1 ? "me" : null, dist: t > 1.2 && t < 3.2, meter: 0 },
      };
    },
  },
  {
    title: "Whole body in the picture",
    text: "Get into push-up position. Head, arms, hips and feet all inside the picture. Too close? Move back.",
    unlock: 4.5,
    loop: 6.5,
    frame: (t) => {
      const m = ramp(t, 1.6, 1.8);
      const ok = m >= 1;
      return {
        shot: { phoneView: 1, me: { depth: idle(t), x: 0.4 * (1 - m), z: 0.55 * (1 - m), yaw: -0.25 * (1 - m) } },
        ui: { border: ok ? "ok" : "bad", skeleton: ok ? "me" : null, meter: 0, check: t > 3.6 },
      };
    },
  },
  {
    title: "Green border = ready",
    text: "Green means the game sees you. Red means it can't: get your whole body in, and keep your knees off the floor.",
    unlock: 4,
    loop: 5.5,
    frame: (t) => {
      const k = 1 - ramp(t, 1.5, 0.8);
      return {
        shot: { phoneView: 1, me: { depth: idle(t) * 0.5 + 0.1 * k, knees: k } },
        ui: { border: k > 0.05 ? "bad" : "ok", skeleton: "me", meter: 0, check: t > 2.5 },
      };
    },
  },
  {
    title: "Go down, come up",
    text: "Lower your chest until the meter on the right is full, then push all the way up. A bright flash means the rep counted.",
    unlock: 4.5,
    loop: 6.2,
    frame: (t) => {
      const r = reps([1.3, 2.6, 3.9, 5.2], t, 0.2);
      return {
        shot: { phoneView: 1, me: { depth: t < 0.2 ? 0 : r.depth } },
        ui: { border: "ok", skeleton: "me", meter: r.depth, flash: r.flash, reps: r.n },
      };
    },
  },
  {
    title: "Fair fight",
    text: "In a battle the game locks onto you. If someone else takes your place, the screen turns red and the battle pauses until you're back.",
    unlock: 6.5,
    loop: 8.5,
    frame: (t) => {
      const out = ramp(t, 2.2, 0.8), back = ramp(t, 6.3, 0.9);
      const inn = ramp(t, 2.7, 0.8), leave = ramp(t, 5.5, 0.8);
      const r = reps([0.9, 1.9], t, 0);
      const ir = reps([3.8, 4.8], t, 2.9);
      const swapped = t > 2.7 && t < 6.6;
      const intruderOn = inn > 0.5 && leave < 0.5;
      return {
        shot: {
          phoneView: 1,
          me: { depth: t < 2.2 ? r.depth : idle(t), x: -1.9 * out * (1 - back), show: out >= 1 && back <= 0 ? 0 : 1 },
          intruder: { depth: ir.depth, x: 1.9 * (1 - inn) + 1.9 * leave, show: inn * (1 - leave) },
        },
        ui: { border: swapped ? "switch" : "ok", skeleton: intruderOn ? "intruder" : out < 0.6 || back > 0.4 ? "me" : null, warn: t > 3.1 && t < 6.0, meter: t < 2.2 ? r.depth : 0 },
      };
    },
  },
  {
    title: "Battle!",
    text: "Match the faded shadow, wait for GO, then out-push your rival before time runs out. Win and you take their Respect.",
    unlock: GO + MATCH_LEN + 1.2,
    frame: (t) => {
      const fix = ramp(t, 0.9, 2.0);
      const ghost = t < 3.0 ? clamp(t / 0.5) : 1 - clamp((t - 3.0) / 0.6);
      const mt = t - GO;
      const r = reps(MY_REPS, Math.max(0, mt), 0);
      const my = mt > 0 ? r.n : 0;
      const opp = mt > 0 ? countBefore(OPP_REPS, Math.min(mt, MATCH_LEN)) : 0;
      const phase = t < SETUP ? "setup" : t < GO ? "count" : mt < MATCH_LEN + 0.4 ? "match" : "result";
      const depth = phase === "match" && mt < MATCH_LEN ? r.depth : idle(t);
      return {
        shot: {
          phoneView: 1,
          me: { depth, x: 0.85 * (1 - fix), z: -0.15 * (1 - fix), yaw: 0.35 * (1 - fix) },
          ghost: { depth: 0.03, show: ghost },
        },
        ui: {
          border: fix < 1 ? "bad" : "ok",
          skeleton: "me",
          meter: phase === "match" ? depth : 0,
          flash: phase === "match" && r.flash,
          hint: t > 0.3 && t < 3.0 ? "Match the shadow" : undefined,
          battle: { my, opp, secs: Math.max(0, Math.ceil(MATCH_LEN - Math.max(0, mt))), phase, count: phase === "count" ? 3 - Math.floor(t - SETUP) : undefined },
        },
      };
    },
  },
];

type Props = { onDone: () => void; first?: number; me?: { name: string; avatar: string | null; legendary?: boolean } };

export default function HowToPlay({ onDone, first = 0, me = { name: "You", avatar: null } }: Props) {
  const [i, setI] = useState(Math.min(STEPS.length - 1, Math.max(0, first)));
  const [ui, setUi] = useState<UI>({ border: "none" });
  const [unlocked, setUnlocked] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLCanvasElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const meterLabelRef = useRef<HTMLDivElement>(null);
  const distRef = useRef<HTMLDivElement>(null);
  const lockRef = useRef<HTMLSpanElement>(null);
  const stepRef = useRef({ i: 0, start: performance.now() });

  useEffect(() => {
    stepRef.current = { i, start: performance.now() };
    setUnlocked(false);
  }, [i]);

  useEffect(() => {
    // a fresh canvas per mount, so a remount never shares a WebGL context with the old one
    const glCanvas = document.createElement("canvas");
    glCanvas.className = "view";
    glRef.current!.appendChild(glCanvas);
    const stage = new Stage(glCanvas);
    const lines = lineRef.current!;
    const ctx = lines.getContext("2d")!;
    const host = screenRef.current!;
    let w = 1, h = 1;
    const fit = () => {
      w = host.clientWidth;
      h = host.clientHeight;
      stage.resize(w, h);
      const dpr = Math.min(window.devicePixelRatio, 2);
      lines.width = w * dpr;
      lines.height = h * dpr;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    let raf = 0, last = "";
    const t0 = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const { i: si, start } = stepRef.current;
      const step = STEPS[si];
      const el = (now - start) / 1000;
      const t = step.loop ? el % step.loop : el;
      const { shot, ui: u } = step.frame(t);
      stage.render(shot, (now - t0) / 1000);

      ctx.clearRect(0, 0, lines.width, lines.height);
      const fig = u.skeleton === "me" ? stage.me : u.skeleton === "intruder" ? stage.intruder : null;
      if (fig) drawStickman(ctx, stage.landmarks(fig), lines.width, lines.height);

      host.classList.toggle("track-ok", u.border === "ok");
      host.classList.toggle("track-bad", u.border === "bad" || u.border === "switch");
      host.classList.toggle("body-switch", u.border === "switch");
      host.classList.toggle("rep-flash", !!u.flash);
      const m = clamp(u.meter ?? 0);
      if (meterRef.current) {
        const blocks = meterRef.current.children;
        const lit = Math.round(m * blocks.length);
        for (let b = 0; b < blocks.length; b++) blocks[b].classList.toggle("on", blocks.length - b <= lit);
        meterRef.current.classList.toggle("reached", m > 0.9);
      }
      if (meterLabelRef.current) meterLabelRef.current.textContent = `${Math.round(m * 100)}%`;
      if (distRef.current && u.dist) {
        const p = stage.toScreen(0, 0.02, 1.0);
        distRef.current.style.left = `${p.x * 100}%`;
        distRef.current.style.top = `${p.y * 100}%`;
      }
      if (lockRef.current) lockRef.current.style.width = `${clamp(el / step.unlock) * 100}%`;
      if (el >= step.unlock) setUnlocked(true);

      const key = JSON.stringify([u.border === "none", u.reps, u.check, u.warn, u.dist, u.hint, u.battle]);
      if (key !== last) {
        last = key;
        setUi(u);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      stage.dispose();
      glCanvas.remove();
    };
  }, []);

  const finish = () => {
    try { localStorage.setItem(HOWTO_KEY, "1"); } catch { /* private mode: show again next time */ }
    onDone();
  };
  const step = STEPS[i];
  const lastStep = i === STEPS.length - 1;
  const b = ui.battle;
  const mode = MODES.brawl;

  return (
    <div className="howto">
      <div className="screen howto-screen" ref={screenRef}>
        <div ref={glRef} className="view" />
        <canvas ref={lineRef} className="view" />
        <div className="vignette" />

        {b && (
          <>
            <Hud myReps={b.my} oppReps={b.opp} me={me} opp={{ name: "Rival", avatar: null }} secondsLeft={b.secs} barStep={mode.barStep} />
            <div className="mode-tag">{mode.name} · demo</div>
          </>
        )}
        {ui.border !== "none" && (
          <div className="meter-wrap">
            <div className="meter" ref={meterRef}>
              {Array.from({ length: METER_SEGMENTS }, (_, k) => <div key={k} className="block" />)}
            </div>
            <div className="meter-label" ref={meterLabelRef}>0%</div>
          </div>
        )}
        {ui.dist && <div className="howto-dist" ref={distRef}>≈ 2 m <small>(about 6.5 ft)</small></div>}
        {ui.check && <div className="howto-check" aria-hidden>✓</div>}
        {ui.reps !== undefined && <div className="howto-reps"><b>{ui.reps}</b><span>reps</span></div>}
        {ui.hint && <div className="howto-hint">{ui.hint}</div>}
        {ui.warn && (
          <div className="switch-warning">
            <div className="switch-title">Switching body</div>
            <div>A different person is in front of the camera. Paused until the player who started comes back.</div>
          </div>
        )}
        {b?.phase === "count" && (
          <div className="stage-center"><div key={b.count} className="countdown">{b.count}</div></div>
        )}
        {b?.phase === "match" && b.secs >= MATCH_LEN && (
          <div className="stage-center"><div className="countdown">GO</div></div>
        )}
        {b?.phase === "result" && (
          <div className="result-full win howto-result">
            <div className="result-rays" />
            <div className="result-word">Victory</div>
            <div className="result-score"><span className="me">{b.my}</span><span className="dash">–</span><span className="opp">{b.opp}</span></div>
            <div className="result-names"><span>{me.name}</span><span>Rival</span></div>
            <div className="result-respect">+{mode.bet} Respect</div>
          </div>
        )}

        <div className={`howto-panel panel ${b ? "slim" : ""}`}>
          <div className="guide-step">How to play · {i + 1} / {STEPS.length}</div>
          <div className="howto-title">{step.title}</div>
          <p className="howto-text">{step.text}</p>
          <div className="howto-row">
            <div className="guide-dots">{STEPS.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}</div>
            <div className="howto-btns">
            {i > 0 && (
              <button className="game-btn wood howto-back" onClick={() => setI(i - 1)} aria-label="Previous step">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
              </button>
            )}
            <button className={`game-btn jade howto-next ${unlocked ? "" : "locked"}`} disabled={!unlocked}
              onClick={() => (lastStep ? finish() : setI(i + 1))}>
              {!unlocked && <span className="howto-lock" ref={lockRef} />}
              <span className="howto-next-label">{lastStep ? "Fight!" : "Next"}</span>
            </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
