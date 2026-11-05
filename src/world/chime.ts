// The call: a soft bell-like three-note chime, made on the fly (no sound file).
// Every player has their own little tune, picked from their id, so friends learn each other's call.

let ctx: AudioContext | null = null;
const audio = () => {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  } catch {
    ctx = null;
  }
  return ctx;
};

// call once from a tap so the phone allows sound later
export const unlockChime = () => { audio(); };

// a pentatonic scale, so any three notes sound sweet together
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];

function tuneFor(id: string) {
  let h = 7;
  for (const ch of id) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  const a = h % 5, b = a + 1 + ((h >> 3) % 2), c = Math.min(SCALE.length - 1, b + 1 + ((h >> 5) % 2));
  return [SCALE[a], SCALE[b], SCALE[c]];
}

// volume 0..1 (quieter when the caller is far away)
export function playChime(id: string, volume = 1) {
  const ac = audio();
  if (!ac || volume <= 0.01) return;
  const t0 = ac.currentTime + 0.02;
  const out = ac.createGain();
  out.gain.value = 0.22 * volume;
  out.connect(ac.destination);
  tuneFor(id).forEach((f, i) => {
    const t = t0 + i * 0.13;
    for (const [mult, type, amp] of [[1, "sine", 1], [2.01, "triangle", 0.18], [3.98, "sine", 0.06]] as const) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f * mult * 1.012, t);
      o.frequency.exponentialRampToValueAtTime(f * mult, t + 0.08); // a tiny swoop into the note
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 1.3 - i * 0.2);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.4);
    }
  });
}
