import { SOUND_VOLUME } from "./config";

// Small synthesized sound effects (no audio files to download).
// Browsers only allow sound after the first tap, so the audio context unlocks on the first touch.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = SOUND_VOLUME;
    master.connect(ctx.destination);
  }
  return ctx;
}

if (typeof window !== "undefined") {
  const unlock = () => audio()?.resume();
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; at?: number; to?: number } = {}) {
  const a = audio();
  if (!a || a.state !== "running" || !master) return;
  const t = a.currentTime + (opts.at ?? 0);
  const o = a.createOscillator(), g = a.createGain();
  o.type = opts.type ?? "triangle";
  o.frequency.setValueAtTime(freq, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.4, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, opts: { vol?: number; at?: number; freq?: number } = {}) {
  const a = audio();
  if (!a || a.state !== "running" || !master) return;
  const t = a.currentTime + (opts.at ?? 0);
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } // brown noise
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = opts.freq ?? 400;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.6, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

// A gong: low partials that ring out.
function gong(at = 0, base = 110) {
  [1, 2.01, 2.76, 4.07].forEach((k, i) => tone(base * k, 2.2 - i * 0.4, { type: "sine", vol: 0.35 / (i + 1), at }));
}

export const repSound = () => { tone(1046, 0.09, { type: "square", vol: 0.12 }); tone(1568, 0.12, { vol: 0.15, at: 0.02 }); };
export const countdownSound = () => tone(660, 0.18, { type: "square", vol: 0.15 });
export const goSound = () => { gong(0, 98); tone(784, 0.3, { type: "square", vol: 0.15 }); };
export const victorySound = () => {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, { type: "square", vol: 0.16, at: i * 0.12 }));
  tone(1318, 0.9, { type: "triangle", vol: 0.25, at: 0.5 });
  gong(0.5, 131);
};
export const defeatSound = () => {
  [392, 349, 311, 262].forEach((f, i) => tone(f, 0.4, { type: "sawtooth", vol: 0.1, at: i * 0.18 }));
  gong(0.7, 73);
};
export const drawSound = () => { tone(523, 0.3, { vol: 0.2 }); tone(523, 0.5, { vol: 0.2, at: 0.3 }); };
export const thunder = () => { noise(2.6, { vol: 0.5, freq: 260 }); noise(1.2, { vol: 0.35, freq: 900, at: 0.05 }); };

// A spoken announcer line in a female voice (uses the phone's built-in text-to-speech).
// Phones name their voices differently, so known female voices are tried first, then any
// English voice with a raised pitch.
const FEMALE = /female|woman|samantha|victoria|karen|moira|tessa|fiona|serena|zira|susan|hazel|heera|veena|kate|allison|ava|nicky|google uk english female|google us english/i;
const MALE = /male|daniel|alex|fred|george|rishi|david|mark|james/i;

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  return (
    en.find((v) => FEMALE.test(v.name) && !/\bmale\b/i.test(v.name)) ??
    en.find((v) => !MALE.test(v.name)) ??
    en[0] ??
    null
  );
}
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.getVoices(); // starts loading the voice list early
  // iPhones only allow speech after a tap, so speak a silent line on the first tap.
  const unlockSpeech = () => {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
    window.removeEventListener("pointerdown", unlockSpeech);
  };
  window.addEventListener("pointerdown", unlockSpeech, { passive: true });
}

export function announce(text: string, delay = 0) {
  const synth = window.speechSynthesis;
  if (!synth || SOUND_VOLUME <= 0) return;
  setTimeout(() => {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? "en-US";
    u.pitch = v && FEMALE.test(v.name) ? 1.25 : 1.6; // unknown voice: pitch it up so it sounds female
    u.rate = 0.95;
    u.volume = Math.min(1, SOUND_VOLUME + 0.3);
    synth.speak(u);
  }, delay);
}

export const victoryCall = () => announce("Victory!", 350);
