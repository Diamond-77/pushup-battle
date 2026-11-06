import * as THREE from "three";

// The citadel's sky follows the player's real clock: bright day, a pink-orange dusk, a violet
// cyberpunk night. It rains only on Tuesdays, Wednesdays and Saturdays (stormy grey by day, black
// storm by night). ?hour=22&wday=3 in the address overrides the clock, for testing.

export const RAIN_DAYS = [2, 3, 6]; // Tue, Wed, Sat (Date.getDay)
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Look = { sky: [string, string, string]; fog: number; hemiSky: number; hemiGround: number; hemi: number; sun: number; sunI: number };
const L = {
  day: { sky: ["#2e6fb8", "#8cc0e6", "#f2d9c4"], fog: 0xc3cfda, hemiSky: 0xe6f0ff, hemiGround: 0x5a5048, hemi: 1.3, sun: 0xfff0d8, sunI: 2.3 },
  dusk: { sky: ["#2b2a6b", "#d8607a", "#ffb070"], fog: 0xb8707a, hemiSky: 0xffc0b0, hemiGround: 0x3a2a30, hemi: 1.05, sun: 0xff9a5a, sunI: 2.0 },
  night: { sky: ["#04030c", "#160f33", "#3b1b4f"], fog: 0x1d1430, hemiSky: 0x9a8ce6, hemiGround: 0x16101c, hemi: 0.8, sun: 0xb4c4ff, sunI: 0.8 },
  rainDay: { sky: ["#1c222c", "#3a434f", "#5d6671"], fog: 0x4a525c, hemiSky: 0xb0bccc, hemiGround: 0x22262a, hemi: 1.0, sun: 0xa6b0c0, sunI: 0.9 },
  rainNight: { sky: ["#07090e", "#141922", "#262c36"], fog: 0x1c2129, hemiSky: 0x8595a8, hemiGround: 0x14161a, hemi: 0.7, sun: 0x9aa6b8, sunI: 0.55 },
} satisfies Record<string, Look>;

export type SkyNow = Look & { night: number; rain: boolean; wday: number; hour: number };

const q = new URLSearchParams(location.search);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const c1 = new THREE.Color(), c2 = new THREE.Color();
const mixHex = (a: number, b: number, k: number) => c1.setHex(a).lerp(c2.setHex(b), k).getHex();
const mixCss = (a: string, b: string, k: number) => "#" + c1.set(a).lerp(c2.set(b), k).getHexString();
const mix = (a: Look, b: Look, k: number): Look => ({
  sky: [0, 1, 2].map((i) => mixCss(a.sky[i], b.sky[i], k)) as [string, string, string],
  fog: mixHex(a.fog, b.fog, k), hemiSky: mixHex(a.hemiSky, b.hemiSky, k), hemiGround: mixHex(a.hemiGround, b.hemiGround, k),
  hemi: a.hemi + (b.hemi - a.hemi) * k, sun: mixHex(a.sun, b.sun, k), sunI: a.sunI + (b.sunI - a.sunI) * k,
});

export function skyNow(now = new Date()): SkyNow {
  const hour = q.has("hour") ? Number(q.get("hour")) : now.getHours() + now.getMinutes() / 60;
  const wday = q.has("wday") ? Number(q.get("wday")) : now.getDay();
  const rain = RAIN_DAYS.includes(wday);
  // 0 at night, 1 by day: sunrise 5-7, sunset 17:30-19:30
  const d = smooth(5, 7, hour) - smooth(17.5, 19.5, hour);
  let look = rain ? mix(L.rainNight, L.rainDay, d) : mix(L.night, L.day, d);
  if (!rain) look = mix(look, L.dusk, (1 - Math.abs(2 * d - 1)) * 0.85);
  return { ...look, night: 1 - d, rain, wday, hour };
}

// the next rainy day, as words: "today", "tomorrow" or a day name
export function nextRain(wday: number) {
  for (let k = 1; k <= 7; k++) if (RAIN_DAYS.includes((wday + k) % 7)) return k === 1 ? "tomorrow" : DAY_NAMES[(wday + k) % 7];
  return "";
}
