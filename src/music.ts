import { useEffect, useState } from "react";
import { audioOut } from "./sound";
import { AMBIENT_VOLUME, MUSIC_VOLUME, THEME_MUSIC } from "./config";
import type { Weather } from "./clans";

// Theme music and weather ambience for the menu pages.
// Every clan has its own looping theme, composed here in code (nothing copyrighted, nothing to download):
//   Arasaka       – dark minor pentatonic plucks over taiko drums
//   Soraran Gate  – warm major pentatonic flute
//   sleepBuilders – slow in-sen scale bells
//   Lone Warrior  – gentle yo-scale plucks
// A song file in THEME_MUSIC (config.ts) replaces the built-in theme for that clan.
// Ambience follows the weather: storm = rain, sunset = wind and birds, night = crickets, day = birds.

type Voice = "pluck" | "flute" | "bell";
type ThemeDef = { root: number; scale: number[]; bpm: number; voice: Voice; drums: boolean; rest: number; seed: number };
const THEMES: Record<string, ThemeDef> = {
  arasaka: { root: 57, scale: [0, 3, 5, 7, 10], bpm: 92, voice: "pluck", drums: true, rest: 0.3, seed: 7 },
  "soraran-gate": { root: 62, scale: [0, 2, 4, 7, 9], bpm: 76, voice: "flute", drums: false, rest: 0.35, seed: 3 },
  sleepbuilders: { root: 64, scale: [0, 1, 5, 7, 10], bpm: 58, voice: "bell", drums: false, rest: 0.5, seed: 11 },
  lone: { root: 60, scale: [0, 2, 5, 7, 9], bpm: 70, voice: "pluck", drums: false, rest: 0.45, seed: 5 },
};
const STEPS = 32; // eighth notes: a 4-bar phrase that loops like a theme

const KEY = "pb_music";
let enabled = (() => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } })();
const listeners = new Set<(on: boolean) => void>();

export function setMusicOn(on: boolean) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode */ }
  listeners.forEach((l) => l(on));
  apply();
}
export function useMusicOn() {
  const [on, setOn] = useState(enabled);
  useEffect(() => { listeners.add(setOn); return () => { listeners.delete(setOn); }; }, []);
  return on;
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
// a melody for the theme: a seeded walk over two octaves of the scale, landing home at each phrase end
function compose(t: ThemeDef) {
  const r = rng(t.seed);
  const notes: number[] = [];
  let deg = 5;
  for (let i = 0; i < STEPS; i++) {
    if (i % 16 === 15) { notes.push(-1); continue; }
    if (i % 16 === 14) { notes.push(i < 16 ? 7 : 5); continue; }
    if (i % 4 !== 0 && r() < t.rest) { notes.push(-1); continue; }
    deg = Math.max(0, Math.min(9, deg + Math.round((r() - 0.5) * 4)));
    notes.push(deg);
  }
  return notes;
}
const noteOf = (t: ThemeDef, deg: number) => t.root + 12 * Math.floor(deg / 5) + t.scale[deg % 5];

let musicBus: GainNode | null = null;
let ambBus: GainNode | null = null;
let scene: { theme: string; weather: Weather } | null = null;
let playing: { theme: string; notes: number[]; step: number; next: number } | null = null;
let ambient: { weather: Weather; stop: () => void } | null = null;
let fileAudio: HTMLAudioElement | null = null;
let timer = 0;

function buses() {
  const o = audioOut();
  if (!o) return null;
  if (!musicBus) {
    musicBus = o.ctx.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(o.out);
    ambBus = o.ctx.createGain();
    ambBus.gain.value = 0;
    ambBus.connect(o.out);
  }
  return { ctx: o.ctx, music: musicBus, amb: ambBus! };
}

function env(ctx: AudioContext, dest: AudioNode, t: number, attack: number, peak: number, decay: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(dest);
  return g;
}
function osc(ctx: AudioContext, type: OscillatorType, f: number, dest: AudioNode, t: number, dur: number) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.1);
  return o;
}
function noiseBuffer(ctx: AudioContext, seconds: number, brown = false) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

function playNote(ctx: AudioContext, dest: AudioNode, voice: Voice, f: number, t: number, len: number) {
  if (voice === "pluck") { // guzheng-ish: bright attack, quick decay, a soft octave on top
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.8);
    lp.connect(env(ctx, dest, t, 0.005, 0.35, 1.1));
    osc(ctx, "triangle", f, lp, t, 1.2);
    osc(ctx, "sawtooth", f * 2.003, env(ctx, lp, t, 0.005, 0.05, 0.4), t, 0.5);
  } else if (voice === "flute") { // breathy sine with vibrato
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.08);
    g.gain.setValueAtTime(0.24, t + len * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len * 1.6);
    g.connect(dest);
    const o = osc(ctx, "sine", f, g, t, len * 1.6);
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 5.2;
    depth.gain.value = f * 0.006;
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t); lfo.stop(t + len * 1.6 + 0.1);
    osc(ctx, "triangle", f * 2, env(ctx, g, t, 0.08, 0.15, len), t, len * 1.6);
  } else { // bell: inharmonic partials that ring
    [1, 2.76, 5.4].forEach((k, i) => osc(ctx, "sine", f * k, env(ctx, dest, t, 0.004, 0.22 / (i + 1.5), 2.6 - i * 0.7), t, 2.8));
  }
}
function taiko(ctx: AudioContext, dest: AudioNode, t: number, big: boolean) {
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(big ? 95 : 140, t);
  o.frequency.exponentialRampToValueAtTime(big ? 42 : 70, t + 0.35);
  o.connect(env(ctx, dest, t, 0.003, big ? 0.7 : 0.35, 0.45));
  o.start(t); o.stop(t + 0.6);
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 0.2, true);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 500;
  n.connect(lp).connect(env(ctx, dest, t, 0.002, 0.4, 0.15));
  n.start(t);
}
function pad(ctx: AudioContext, dest: AudioNode, f: number, t: number, len: number) {
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 650;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.07, t + len * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  lp.connect(g).connect(dest);
  for (const k of [1, 1.5]) for (const d of [-4, 4]) {
    const o = osc(ctx, "sawtooth", f * k, lp, t, len);
    o.detune.value = d;
  }
}

function tick() {
  const b = buses();
  if (!b || b.ctx.state !== "running" || !playing || document.hidden) return;
  const t = THEMES[playing.theme] ?? THEMES.lone;
  const step = 60 / t.bpm / 2;
  if (playing.next < b.ctx.currentTime) playing.next = b.ctx.currentTime + 0.05;
  while (playing.next < b.ctx.currentTime + 0.35) {
    const i = playing.step % STEPS, at = playing.next;
    const deg = playing.notes[i];
    if (deg >= 0) playNote(b.ctx, b.music, t.voice, midi(noteOf(t, deg)), at, step * (t.voice === "flute" ? 2 : 1));
    if (i % 16 === 0) pad(b.ctx, b.music, midi(t.root - 24 + (i === 16 ? t.scale[3] : 0)), at, step * 16);
    if (t.drums && [0, 6, 8, 14, 16, 22, 24, 27, 30].includes(i)) taiko(b.ctx, b.music, at, i % 8 === 0);
    playing.step++;
    playing.next += step;
  }
}

function startAmbient(weather: Weather) {
  const b = buses();
  if (!b) return null;
  const { ctx, amb } = b;
  const nodes: AudioScheduledSourceNode[] = [];
  const loopNoise = (brown: boolean, filter: BiquadFilterType, freq: number, vol: number, q = 0.7) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 3, brown);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(amb);
    src.start();
    nodes.push(src);
    return { f, g };
  };
  let chirps = 0;
  const every = (min: number, max: number, fn: () => void) => {
    const go = () => { fn(); chirps = window.setTimeout(go, (min + Math.random() * (max - min)) * 1000); };
    chirps = window.setTimeout(go, min * 1000);
  };
  const chirp = (base: number, n: number) => {
    if (ctx.state !== "running" || document.hidden) return;
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * 0.11;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.45, t + 0.07);
      o.connect(env(ctx, amb, t, 0.01, 0.12, 0.08));
      o.start(t); o.stop(t + 0.15);
    }
  };
  if (weather === "storm") {
    loopNoise(false, "highpass", 900, 0.32); // rain hiss
    loopNoise(true, "lowpass", 300, 0.5); // the roar of heavy rain
  } else if (weather === "sunset") {
    const w = loopNoise(true, "bandpass", 450, 0.9, 0.8); // wind
    const lfo = ctx.createOscillator(), d = ctx.createGain();
    lfo.frequency.value = 0.12; d.gain.value = 250;
    lfo.connect(d).connect(w.f.frequency);
    lfo.start(); nodes.push(lfo);
    every(3, 8, () => chirp(2400 + Math.random() * 900, 2 + Math.floor(Math.random() * 3)));
  } else if (weather === "night") {
    loopNoise(true, "lowpass", 350, 0.35); // soft night air
    every(0.8, 2.2, () => { // crickets
      if (ctx.state !== "running" || document.hidden) return;
      const f = 4100 + Math.random() * 500;
      for (let i = 0; i < 3; i++) {
        const t = ctx.currentTime + i * 0.06;
        const o = ctx.createOscillator();
        o.type = "sine"; o.frequency.value = f;
        o.connect(env(ctx, amb, t, 0.004, 0.05, 0.04));
        o.start(t); o.stop(t + 0.08);
      }
    });
  } else {
    loopNoise(true, "bandpass", 600, 0.4, 0.6);
    every(2, 6, () => chirp(2800 + Math.random() * 800, 2 + Math.floor(Math.random() * 2)));
  }
  return () => { clearTimeout(chirps); nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } }); };
}

function fade(g: GainNode | null, to: number, s = 0.8) {
  if (!g) return;
  const now = g.context.currentTime;
  g.gain.cancelScheduledValues(now);
  g.gain.setValueAtTime(g.gain.value, now);
  g.gain.linearRampToValueAtTime(to, now + s);
}

function apply() {
  const want = enabled ? scene : null;
  const b = buses();
  // ambience
  if (ambient && ambient.weather !== want?.weather) { const old = ambient; fade(ambBus, 0, 0.5); setTimeout(old.stop, 600); ambient = null; }
  if (want && !ambient && b) {
    const stop = startAmbient(want.weather);
    if (stop) { ambient = { weather: want.weather, stop }; setTimeout(() => fade(ambBus, AMBIENT_VOLUME, 1.2), ambBus && ambBus.gain.value > 0.01 ? 650 : 0); }
  }
  // theme
  const file = want ? THEME_MUSIC[want.theme] : undefined;
  if (fileAudio && (!file || !fileAudio.src.endsWith(file))) { fileAudio.pause(); fileAudio = null; }
  if (file && !fileAudio) {
    fileAudio = new Audio(file);
    fileAudio.loop = true;
    fileAudio.volume = MUSIC_VOLUME;
    fileAudio.play().catch(() => { /* waits for the first tap */ });
  }
  const synthTheme = want && !file ? want.theme : null;
  if (playing?.theme !== synthTheme) {
    if (playing) fade(musicBus, 0, 0.6);
    const next = synthTheme;
    setTimeout(() => {
      playing = next ? { theme: next, notes: compose(THEMES[next] ?? THEMES.lone), step: 0, next: 0 } : null;
      if (next) fade(musicBus, MUSIC_VOLUME, 1.5);
    }, playing ? 650 : 0);
  }
  if (!timer) timer = window.setInterval(tick, 100);
}

// Which clan's theme and weather to play. null = silence (a battle or training is on).
export function setMusicScene(theme: string | null, weather: Weather | null) {
  const next = theme && weather ? { theme, weather } : null;
  if (next?.theme === scene?.theme && next?.weather === scene?.weather) return;
  scene = next;
  apply();
}

if (typeof window !== "undefined") {
  // start as soon as the first tap unlocks audio
  const kick = () => { setTimeout(apply, 50); if (fileAudio?.paused) fileAudio.play().catch(() => {}); };
  window.addEventListener("pointerdown", kick, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { fade(musicBus, 0, 0.2); fade(ambBus, 0, 0.2); fileAudio?.pause(); }
    else if (enabled && scene) { fade(musicBus, playing ? MUSIC_VOLUME : 0, 0.8); fade(ambBus, ambient ? AMBIENT_VOLUME : 0, 0.8); fileAudio?.play().catch(() => {}); }
  });
}
