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

type Voice = "koto" | "flute" | "bell";
// prog = chord roots (semitones) for each bar of the 4-bar loop
type ThemeDef = { root: number; scale: number[]; bpm: number; voice: Voice; drums: 0 | 1 | 2; seed: number; prog: number[]; density: number };
const MINOR = [0, 3, 5, 7, 10], MAJOR = [0, 2, 4, 7, 9], INSEN = [0, 1, 5, 7, 10], YO = [0, 2, 5, 7, 9];
const THEMES: Record<string, ThemeDef> = {
  // clans (home, clan, throne, profile)
  arasaka: { root: 57, scale: MINOR, bpm: 84, voice: "koto", drums: 1, seed: 7, prog: [0, -4, -7, -2], density: 0.6 },
  "soraran-gate": { root: 62, scale: MAJOR, bpm: 72, voice: "flute", drums: 0, seed: 3, prog: [0, -3, 5, 7], density: 0.45 },
  sleepbuilders: { root: 64, scale: INSEN, bpm: 56, voice: "bell", drums: 0, seed: 11, prog: [0, -4, -2, -5], density: 0.35 },
  lone: { root: 60, scale: YO, bpm: 68, voice: "koto", drums: 0, seed: 5, prog: [0, 5, -3, 7], density: 0.45 },
  // battle modes, while choosing a battlefield (never during the fight itself)
  brawl: { root: 55, scale: MINOR, bpm: 112, voice: "koto", drums: 2, seed: 21, prog: [0, -2, -4, -2], density: 0.75 },
  classic: { root: 59, scale: MINOR, bpm: 96, voice: "flute", drums: 1, seed: 17, prog: [0, -4, -7, -5], density: 0.55 },
  rank: { root: 52, scale: INSEN, bpm: 100, voice: "koto", drums: 2, seed: 29, prog: [0, 1, -4, -2], density: 0.65 },
  training: { root: 62, scale: YO, bpm: 88, voice: "koto", drums: 1, seed: 13, prog: [0, 5, 7, 5], density: 0.55 },
};
const STEPS = 32; // eighth notes: a 4-bar phrase that loops like a theme

const read = (k: string) => { try { return localStorage.getItem(k) !== "off"; } catch { return true; } };
const prefs = { music: read("pb_music"), ambience: read("pb_ambience") };
const listeners = new Set<() => void>();
function save(k: "music" | "ambience", on: boolean) {
  prefs[k] = on;
  try { localStorage.setItem(k === "music" ? "pb_music" : "pb_ambience", on ? "on" : "off"); } catch { /* private mode */ }
  listeners.forEach((l) => l());
  apply();
}
export const setMusicOn = (on: boolean) => save("music", on);
export const setAmbienceOn = (on: boolean) => save("ambience", on);
export function useSoundPrefs() {
  const [, bump] = useState(0);
  useEffect(() => { const l = () => bump((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return { ...prefs };
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
// a tune: a short motif, the motif again a step higher, an answer, then the motif ending home
function compose(t: ThemeDef) {
  const r = rng(t.seed);
  const motif: number[] = [];
  let deg = 5;
  for (let i = 0; i < 8; i++) {
    if (i > 0 && i % 2 === 1 && r() > t.density) { motif.push(-1); continue; }
    deg = Math.max(2, Math.min(9, deg + [-1, 1, -1, 1, -2, 2, 0][Math.floor(r() * 7)]));
    motif.push(deg);
  }
  const shift = (m: number[], k: number) => m.map((d) => (d < 0 ? d : Math.min(10, d + k)));
  const answer = motif.map((d, i) => (d < 0 || i % 3 === 2 ? -1 : Math.max(1, 12 - d - 2)));
  const ending = [...motif.slice(0, 5), 5, -1, -1];
  return [...motif, ...shift(motif, 1), ...answer, ...ending];
}
const noteOf = (t: ThemeDef, deg: number) => t.root + 12 * Math.floor(deg / 5) + t.scale[deg % 5];

let musicBus: GainNode | null = null;
let wet: AudioNode | null = null; // reverb: makes the synth sound like it's played in a hall
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
    const verb = o.ctx.createConvolver();
    const len = Math.floor(o.ctx.sampleRate * 2.8);
    const ir = o.ctx.createBuffer(2, len, o.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    verb.buffer = ir;
    const send = o.ctx.createGain();
    send.gain.value = 0.45;
    send.connect(verb).connect(musicBus);
    wet = send;
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

function playNote(ctx: AudioContext, dry: AudioNode, voice: Voice, f: number, t: number, len: number) {
  const out = ctx.createGain();
  out.connect(dry);
  if (wet) out.connect(wet);
  if (voice === "koto") { // soft plucked string: mellow tone that fades out
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + 1.2);
    lp.connect(env(ctx, out, t, 0.006, 0.22, 1.6));
    osc(ctx, "triangle", f, lp, t, 1.8);
    osc(ctx, "sine", f * 2, env(ctx, lp, t, 0.004, 0.06, 0.5), t, 0.6);
  } else if (voice === "flute") { // breathy sine with a gentle vibrato
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.12);
    g.gain.setValueAtTime(0.14, t + len * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len * 1.5);
    g.connect(out);
    const o = osc(ctx, "sine", f, g, t, len * 1.5);
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 4.8;
    depth.gain.value = f * 0.004;
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t); lfo.stop(t + len * 1.5 + 0.1);
  } else { // bell: a few soft partials that ring
    [1, 2.0, 3.01].forEach((k, i) => osc(ctx, "sine", f * k, env(ctx, out, t, 0.004, 0.13 / (i + 1), 2.4 - i * 0.6), t, 2.6));
  }
}
function taiko(ctx: AudioContext, dest: AudioNode, t: number, big: boolean) {
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(big ? 95 : 140, t);
  o.frequency.exponentialRampToValueAtTime(big ? 42 : 70, t + 0.35);
  o.connect(env(ctx, dest, t, 0.003, big ? 0.38 : 0.18, 0.45));
  o.start(t); o.stop(t + 0.6);
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 0.2, true);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 500;
  n.connect(lp).connect(env(ctx, dest, t, 0.002, 0.15, 0.12));
  n.start(t);
}
function pad(ctx: AudioContext, dest: AudioNode, f: number, minor: boolean, t: number, len: number) {
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.035, t + len * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len * 1.05);
  lp.connect(g).connect(dest);
  if (wet) g.connect(wet);
  for (const k of [1, minor ? 1.189 : 1.26, 1.498]) for (const d of [-5, 5]) {
    const o = osc(ctx, "triangle", f * k, lp, t, len * 1.1);
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
    if (i % 8 === 0) pad(b.ctx, b.music, midi(t.root - 12 + t.prog[i / 8]), t.scale[1] === 3 || t.scale[1] === 1, at, step * 8);
    if (t.drums === 1 && i % 8 === 0) taiko(b.ctx, b.music, at, true);
    if (t.drums === 2 && [0, 3, 6, 8, 11, 14].includes(i % 16)) taiko(b.ctx, b.music, at, i % 8 === 0);
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

// a player's song is playing (throne / profile): the clan theme steps aside, the weather stays
let songs = 0;
export function setSongActive(on: boolean) {
  songs = Math.max(0, songs + (on ? 1 : -1));
  apply();
}

function apply() {
  const b = buses();
  const wantAmb = prefs.ambience ? scene : null;
  const want = prefs.music && songs === 0 ? scene : null;
  // ambience
  if (ambient && ambient.weather !== wantAmb?.weather) { const old = ambient; fade(ambBus, 0, 0.5); setTimeout(old.stop, 600); ambient = null; }
  if (wantAmb && !ambient && b) {
    const stop = startAmbient(wantAmb.weather);
    if (stop) { ambient = { weather: wantAmb.weather, stop }; setTimeout(() => fade(ambBus, AMBIENT_VOLUME, 1.2), ambBus && ambBus.gain.value > 0.01 ? 650 : 0); }
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
    else if (scene) { fade(musicBus, playing ? MUSIC_VOLUME : 0, 0.8); fade(ambBus, ambient ? AMBIENT_VOLUME : 0, 0.8); fileAudio?.play().catch(() => {}); }
  });
}
