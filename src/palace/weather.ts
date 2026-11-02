import type { Weather } from "../clans";

// Light, sky and effects for each clan's palace.
export type Env = {
  sky: [string, string, string]; // top, middle, horizon
  fog: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sun: number;
  sunI: number;
  sunPos: [number, number, number];
  mountainTint: number; // multiplies the painted mountain layers
  lamp: number; // lantern glow
  rain?: boolean;
  lightning?: boolean;
  stars?: boolean;
  moon?: boolean;
  fireflies?: boolean;
  sunDisk?: number; // color of a low sun on the horizon
};

export const ENVS: Record<Weather, Env> = {
  day: {
    sky: ["#6fa8d6", "#bcd8ec", "#f4ecdc"], fog: 0xe4ecf0, fogNear: 180, fogFar: 650,
    hemiSky: 0xdfefff, hemiGround: 0x6f8f4a, hemi: 1.4, sun: 0xfff1d6, sunI: 2.2, sunPos: [-60, 110, 70],
    mountainTint: 0xffffff, lamp: 0.3,
  },
  sunset: {
    sky: ["#3a3f73", "#e2846a", "#ffd39a"], fog: 0xf2b88c, fogNear: 150, fogFar: 600,
    hemiSky: 0xffc9a0, hemiGround: 0x5a463a, hemi: 1.1, sun: 0xffa463, sunI: 2.6, sunPos: [-130, 45, -60],
    mountainTint: 0xf3b5a0, lamp: 0.9, sunDisk: 0xffb86b,
  },
  night: {
    sky: ["#050813", "#121c38", "#2a3557"], fog: 0x1a2238, fogNear: 110, fogFar: 520,
    hemiSky: 0x7385c4, hemiGround: 0x0e141c, hemi: 0.45, sun: 0xb4c4ff, sunI: 0.7, sunPos: [90, 120, -60],
    mountainTint: 0x3a4766, lamp: 2.2, stars: true, moon: true, fireflies: true,
  },
  storm: {
    sky: ["#0f1217", "#232932", "#3a4049"], fog: 0x2a3039, fogNear: 60, fogFar: 380,
    hemiSky: 0x8595a8, hemiGround: 0x1a1e18, hemi: 0.65, sun: 0x9aa6b8, sunI: 0.55, sunPos: [-40, 120, 40],
    mountainTint: 0x434b57, lamp: 1.4, rain: true, lightning: true,
  },
};
