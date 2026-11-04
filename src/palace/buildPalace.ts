import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Env } from "./weather";

// Builds a detailed, stylized sect palace in an ink-and-paint look:
// cel shading, dark ink outlines, painted textures for roof tiles and lattice windows.
// Every clan gets its own palace: the clan name seeds the colors, tiers, towers and trees.
// Units are roughly meters, so characters can walk around it later.
// Static parts are merged into a few meshes so phones only draw a handful of objects.

export type PalaceStyle = {
  wall: number;
  roof: number;
  trim: number;
  banner: number;
  mainTiers: number;
  sideTowers: 0 | 2 | 4;
  greenery: number; // 0..1, how overgrown
  autumn: number; // 0..1, share of red/orange maples
};

const WALLS = [0xb23a2e, 0xa4432c, 0x8e2f2a, 0x2f6e5c, 0x3a3f5c];
const ROOFS = [0x4d5562, 0x3d6b5f, 0x555049, 0x34394a, 0x2f6d6b];
const BANNERS = [0xc8372d, 0x3fbf8a, 0x3b6fd1, 0xe8b84a, 0x8e44ad];
const BAY = 3.2; // one lattice bay of wall texture, in meters
const TILE = 1.4; // one repeat of the roof tile texture, in meters
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

export function rngFrom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function styleFor(clan: string): PalaceStyle {
  const r = rngFrom(clan);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  return {
    wall: pick(WALLS),
    roof: pick(ROOFS),
    trim: 0xd9a441,
    banner: pick(BANNERS),
    mainTiers: 4 + Math.floor(r() * 3),
    sideTowers: pick([2, 2, 4, 4, 0] as const),
    greenery: 0.3 + r() * 0.6,
    autumn: r() * 0.8,
  };
}

/* ---------- painted textures ---------- */

export const css = (n: number, k = 1) => {
  const c = new THREE.Color(n);
  c.r = Math.min(1, c.r * k);
  c.g = Math.min(1, c.g * k);
  c.b = Math.min(1, c.b * k);
  return "#" + c.getHexString();
};

export function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// One bay of wall: painted frieze on top, pillars at the sides, a lattice window, stone plinth.
function wallTexture(wall: number) {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = css(wall);
    x.fillRect(0, 0, w, h);
    x.fillStyle = "#efe6d2";
    x.fillRect(0, 0, w, h * 0.15);
    x.fillStyle = "#2f6f6a";
    for (let i = 0; i < 8; i++) x.fillRect(i * 32 + 5, h * 0.035, 22, h * 0.08);
    x.fillStyle = "#e8b84a";
    for (let i = 0; i < 8; i++) x.fillRect(i * 32 + 13, h * 0.055, 6, h * 0.04);
    x.fillStyle = css(wall, 0.72);
    x.fillRect(0, h * 0.15, 20, h);
    x.fillRect(w - 20, h * 0.15, 20, h);
    const px = 40, pw = w - 80, py = h * 0.24, ph = h * 0.58;
    x.fillStyle = "#3a2418";
    x.fillRect(px, py, pw, ph);
    x.strokeStyle = css(wall, 1.25);
    x.lineWidth = 2.5;
    for (let gx = px + 11; gx < px + pw; gx += 11) { x.beginPath(); x.moveTo(gx, py); x.lineTo(gx, py + ph); x.stroke(); }
    for (let gy = py + 11; gy < py + ph; gy += 11) { x.beginPath(); x.moveTo(px, gy); x.lineTo(px + pw, gy); x.stroke(); }
    x.strokeStyle = "#1e130c";
    x.lineWidth = 5;
    x.strokeRect(px, py, pw, ph);
    x.beginPath(); x.moveTo(w / 2, py); x.lineTo(w / 2, py + ph); x.stroke();
    x.fillStyle = "#9a9384";
    x.fillRect(0, h * 0.9, w, h * 0.1);
    x.fillStyle = "#6f6a60";
    x.fillRect(0, h * 0.9, w, 3);
  });
}

// Roof tiles: rows of round tiles running down the slope, darker eave with tile ends.
export function roofTexture(roof: number) {
  const t = canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = css(roof);
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const cx = i * 32;
      x.fillStyle = css(roof, 1.35);
      x.fillRect(cx + 3, 0, 13, h);
      x.fillStyle = css(roof, 0.6);
      x.fillRect(cx + 16, 0, 5, h);
    }
    x.fillStyle = "rgba(0,0,0,0.18)";
    for (let j = 0; j < h; j += 12) x.fillRect(0, j, w, 2);
    x.fillStyle = css(roof, 0.5);
    x.fillRect(0, h - 12, w, 12);
    x.fillStyle = "#e6dcc4";
    for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(i * 32 + 9, h - 6, 4.5, 0, 7); x.fill(); }
  });
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function pavingTexture() {
  return canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = "#ddd7c8";
    x.fillRect(0, 0, w, h);
    x.strokeStyle = "#bdb5a2";
    x.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, h); x.stroke();
      x.beginPath(); x.moveTo(0, i * 32); x.lineTo(w, i * 32); x.stroke();
    }
  });
}

/* ---------- materials ---------- */

let ramp: THREE.DataTexture | null = null;
export function toonRamp() {
  if (ramp) return ramp;
  const d = new Uint8Array([95, 95, 95, 255, 180, 180, 180, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}
export const toon = (color: number, map?: THREE.Texture, extra: Partial<THREE.MeshToonMaterialParameters> = {}) =>
  new THREE.MeshToonMaterial({ color: map ? 0xffffff : color, gradientMap: toonRamp(), ...(map ? { map } : {}), ...extra });

export function materials(s: PalaceStyle, env: Env) {
  return {
    wall: toon(0, wallTexture(s.wall)),
    wallPlain: toon(s.wall),
    roof: toon(0, roofTexture(s.roof), { side: THREE.DoubleSide }),
    ridge: toon(new THREE.Color(s.roof).multiplyScalar(0.7).getHex()),
    paving: toon(0, pavingTexture()),
    marble: toon(0xf1ece2),
    marbleShade: toon(0xd8d1c2),
    wood: toon(0x4a2a1c),
    rail: toon(0x6b2a20),
    bracket: toon(0x2f6f6a),
    trim: toon(s.trim),
    lamp: toon(0xfff1c9, undefined, { emissive: 0xffb347, emissiveIntensity: env.lamp }),
    banner: toon(s.banner, undefined, { side: THREE.DoubleSide }),
    grass: toon(0x8dbb63),
    water: toon(0x79bfd0),
    rock: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() }),
  };
}
export type Mats = ReturnType<typeof materials>;

/* ---------- merging builder ---------- */

export class Builder {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private lines: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, outline: boolean) {
    geo.applyMatrix4(m);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat)!.push(geo);
    if (outline) this.lines.push(new THREE.EdgesGeometry(geo, 32));
  }
  finish(root: THREE.Group) {
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    }
    if (this.lines.length) {
      const merged = mergeGeometries(this.lines, false);
      this.lines.forEach((g) => g.dispose());
      root.add(new THREE.LineSegments(merged, new THREE.LineBasicMaterial({ color: 0x2a1c12, transparent: true, opacity: 0.6 })));
    }
  }
}

export type Ctx = { b: Builder; T: THREE.Matrix4; m: Mats };
export const M = (x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, ry), new THREE.Vector3(sx, sy, sz));
export const put = (c: Ctx, geo: THREE.BufferGeometry, mat: THREE.Material, local: THREE.Matrix4, outline = true) =>
  c.b.add(geo, mat, c.T.clone().multiply(local), outline);
export const sub = (c: Ctx, local: THREE.Matrix4): Ctx => ({ ...c, T: c.T.clone().multiply(local) });

export function box(c: Ctx, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, ry = 0, outline = true) {
  put(c, new THREE.BoxGeometry(w, h, d), mat, M(x, y + h / 2, z, ry), outline);
}

// Box whose side faces repeat the wall texture once per bay.
function wallBox(c: Ctx, w: number, h: number, d: number, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4); // px, nx, py, ny, pz, nz
    if (face === 2 || face === 3) uv.setXY(i, 0.5, 0.97);
    else uv.setX(i, (uv.getX(i) * (face < 2 ? d : w)) / BAY);
  }
  put(c, g, c.m.wall, M(x, y + h / 2, z));
}

// Steps rising toward -z, starting at the front edge z.
export function stairs(c: Ctx, w: number, totalH: number, depth: number, x: number, y: number, z: number) {
  const n = Math.max(2, Math.round(totalH / 0.3));
  for (let k = 0; k < n; k++) box(c, w, ((k + 1) * totalH) / n, depth / n, k % 2 ? c.m.marbleShade : c.m.marble, x, y, z - (k + 0.5) * (depth / n), 0, k === 0 || k === n - 1);
  for (const sx of [-1, 1]) box(c, 0.5, totalH + 0.5, depth, c.m.marbleShade, x + sx * (w / 2 + 0.25), y, z - depth / 2);
}

// A beam from a to b (rails, bridge decks).
export function beam(c: Ctx, a: THREE.Vector3, b: THREE.Vector3, thick: number, tall: number, mat: THREE.Material, outline = true) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(X, dir.normalize()), new THREE.Vector3(1, 1, 1));
  put(c, new THREE.BoxGeometry(len, tall, thick), mat, m, outline);
}

// Balustrade along a path of points: posts, a top rail and a lower rail.
export function railing(c: Ctx, pts: THREE.Vector3[], h: number, mat: THREE.Material, closed = false) {
  const path = closed ? [...pts, pts[0]] : pts;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const n = Math.max(1, Math.round(a.distanceTo(b) / 1.6));
    for (let k = 0; k < n; k++) {
      const p = a.clone().lerp(b, k / n);
      box(c, 0.22, h + 0.15, 0.22, mat, p.x, p.y, p.z, 0, false);
    }
    const up = new THREE.Vector3(0, h, 0), mid = new THREE.Vector3(0, h * 0.4, 0);
    beam(c, a.clone().add(up), b.clone().add(up), 0.2, 0.16, mat);
    beam(c, a.clone().add(mid), b.clone().add(mid), 0.12, 0.1, mat, false);
  }
  if (!closed) { const p = path[path.length - 1]; box(c, 0.22, h + 0.15, 0.22, mat, p.x, p.y, p.z, 0, false); }
}
export const rect = (hw: number, hd: number, y: number) => [
  new THREE.Vector3(-hw, y, hd), new THREE.Vector3(hw, y, hd), new THREE.Vector3(hw, y, -hd), new THREE.Vector3(-hw, y, -hd),
];

/* ---------- roofs ---------- */

// Curved roof from faces: each face rises from an eave edge to a ridge edge,
// slopes are concave and the corners sweep up. UVs run the tile texture down the slope.
export function roofFromFaces(faces: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][], h: number, lift: number) {
  const N = 10, R = 6;
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (const [a, b, top0, top1] of faces) {
    const base = pos.length / 3;
    const edge = a.distanceTo(b);
    for (let j = 0; j <= R; j++) {
      const v = j / R;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const p = a.clone().lerp(b, u).lerp(top0.clone().lerp(top1, u), v);
        p.y = h * Math.pow(v, 1.7) + lift * Math.pow(Math.abs(u * 2 - 1), 4) * Math.pow(1 - v, 2);
        pos.push(p.x, p.y, p.z);
        uvs.push((u * edge) / TILE, v);
      }
    }
    for (let j = 0; j < R; j++)
      for (let i = 0; i < N; i++) {
        const k = base + j * (N + 1) + i;
        idx.push(k, k + 1, k + N + 1, k + 1, k + N + 2, k + N + 1);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function roofRect(c: Ctx, w: number, d: number, y: number, sy = 1, overhang = 1.8, lift = 1.5) {
  const h = Math.min(w, d) * 0.42;
  const W = w / 2 + overhang, D = d / 2 + overhang, r = Math.max(0, (w - d) / 2) * 0.85;
  const e = [new THREE.Vector3(-W, 0, D), new THREE.Vector3(W, 0, D), new THREE.Vector3(W, 0, -D), new THREE.Vector3(-W, 0, -D)];
  const t0 = new THREE.Vector3(-r, h, 0), t1 = new THREE.Vector3(r, h, 0);
  const g = roofFromFaces([[e[0], e[1], t0, t1], [e[1], e[2], t1, t1], [e[2], e[3], t1, t0], [e[3], e[0], t0, t0]], h, lift);
  put(c, g, c.m.roof, M(0, y, 0, 0, 1, sy, 1));
  // ridge with upturned ornaments at both ends
  const top = y + h * sy;
  box(c, 2 * r + 0.8, 0.5, 0.5, c.m.ridge, 0, top - 0.15, 0);
  for (const sx of [-1, 1]) {
    put(c, new THREE.BoxGeometry(0.45, 1.3, 0.45), c.m.ridge, M(sx * (r + 0.3), top + 0.45, 0, 0), true);
    put(c, new THREE.BoxGeometry(0.9, 0.35, 0.45), c.m.ridge, M(sx * (r + 0.5), top + 1.0, 0, 0), true);
  }
  return h * sy;
}

function roofPoly(c: Ctx, n: number, radius: number, y: number, h: number, lift = 1.2) {
  const e = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    return new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  });
  const apex = new THREE.Vector3(0, h, 0);
  const faces = e.map((p, i) => [p, e[(i + 1) % n], apex, apex] as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]);
  put(c, roofFromFaces(faces, h, lift), c.m.roof, M(0, y, 0));
  return h;
}

export function finial(c: Ctx, y: number, size = 1) {
  put(c, new THREE.SphereGeometry(0.45 * size, 8, 6), c.m.trim, M(0, y + 0.3 * size, 0), false);
  put(c, new THREE.ConeGeometry(0.3 * size, 2.4 * size, 6), c.m.trim, M(0, y + 1.6 * size, 0), true);
}

/* ---------- buildings ---------- */

type HallOpts = { wallH?: number; tiers?: number; double?: boolean; plinth?: boolean; spire?: boolean };

// A hall or square pagoda: marble plinth, pillared walls with lattice windows,
// painted bracket band, tiled roofs; upper floors get a wooden balcony with railings.
function hall(c: Ctx, w: number, d: number, o: HallOpts = {}) {
  const tiers = o.tiers ?? 1;
  let y = 0, cw = w, cd = d;
  if (o.plinth !== false) {
    box(c, w + 4, 1.1, d + 4, c.m.marble);
    stairs(c, 4.5, 1.1, 2.6, 0, 0, (d + 4) / 2 + 2.6);
    railing(c, rect(w / 2 + 1.8, d / 2 + 1.8, 1.1).slice(1).concat([new THREE.Vector3(-(w / 2 + 1.8), 1.1, d / 2 + 1.8)]), 0.8, c.m.marble);
    y = 1.1;
  }
  for (let t = 0; t < tiers; t++) {
    const wh = (o.wallH ?? 4.4) * (t ? 0.78 : 1);
    wallBox(c, cw, wh, cd, 0, y, 0);
    // pillars around a narrow veranda
    for (const [len, along, fixed] of [[cw, "x", cd / 2 + 0.7], [cw, "x", -(cd / 2 + 0.7)], [cd, "z", cw / 2 + 0.7], [cd, "z", -(cw / 2 + 0.7)]] as const) {
      const n = Math.max(1, Math.round(len / BAY));
      for (let i = 0; i <= n; i++) {
        const q = -len / 2 - 0.7 + (i * (len + 1.4)) / n;
        const px = along === "x" ? q : fixed, pz = along === "x" ? fixed : q;
        put(c, new THREE.CylinderGeometry(0.27, 0.3, wh, 8), c.m.wallPlain, M(px, y + wh / 2, pz), false);
      }
    }
    // bracket band (dougong) under the eaves
    box(c, cw + 1.8, 0.55, cd + 1.8, c.m.wood, 0, y + wh, 0);
    for (const sz of [-1, 1]) {
      const n = Math.round((cw + 1.6) / 0.9);
      for (let i = 0; i <= n; i++) box(c, 0.32, 0.32, 0.55, c.m.bracket, -(cw + 1.6) / 2 + (i * (cw + 1.6)) / n, y + wh + 0.5, sz * (cd / 2 + 1.0), 0, false);
    }
    for (const sx of [-1, 1]) {
      const n = Math.round((cd + 1.6) / 0.9);
      for (let i = 0; i <= n; i++) box(c, 0.55, 0.32, 0.32, c.m.bracket, sx * (cw / 2 + 1.0), y + wh + 0.5, -(cd + 1.6) / 2 + (i * (cd + 1.6)) / n, 0, false);
    }
    y += wh + 0.55;
    if (t < tiers - 1) {
      const eave = roofRect(c, cw + 1.4, cd + 1.4, y, 0.4, 2.0, 1.4);
      y += eave - 0.25;
      cw *= 0.8;
      cd *= 0.8;
      box(c, cw + 1.8, 0.35, cd + 1.8, c.m.wood, 0, y, 0);
      railing(c, rect(cw / 2 + 0.85, cd / 2 + 0.85, y + 0.35), 1.0, c.m.rail, true);
      y += 0.35;
    } else {
      if (o.double) roofRect(c, cw + 4.4, cd + 4.4, y - 1.6, 0.3, 1.8, 1.2);
      const h = roofRect(c, cw + 1.4, cd + 1.4, y, 1, 1.9, 1.6);
      if (o.spire) finial(c, y + h, 1.3);
      y += h;
    }
  }
  return y;
}

// Hexagonal pavilion with a pointed roof.
function pavilion(c: Ctx, r = 3.2, n = 6) {
  put(c, new THREE.CylinderGeometry(r + 1.2, r + 1.4, 0.9, n), c.m.marble, M(0, 0.45, 0, Math.PI / n));
  const ring = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    return new THREE.Vector3(Math.cos(a) * r, 0.9, Math.sin(a) * r);
  });
  ring.forEach((p) => put(c, new THREE.CylinderGeometry(0.22, 0.25, 3.4, 8), c.m.wallPlain, M(p.x, 0.9 + 1.7, p.z), false));
  railing(c, ring.slice(1).concat([ring[0]]), 0.7, c.m.rail);
  put(c, new THREE.CylinderGeometry(r + 0.5, r + 0.5, 0.45, n), c.m.wood, M(0, 0.9 + 3.4 + 0.22, 0, Math.PI / n));
  const h = roofPoly(c, n, r + 2.3, 0.9 + 3.85, 3.2, 1.3);
  finial(c, 0.9 + 3.85 + h, 0.8);
}

export function lantern(c: Ctx, x: number, z: number) {
  const s = sub(c, M(x, 0, z));
  box(s, 0.9, 0.5, 0.9, s.m.marbleShade);
  box(s, 0.35, 1.3, 0.35, s.m.marble, 0, 0.5);
  box(s, 0.8, 0.7, 0.8, s.m.lamp, 0, 1.8);
  put(s, new THREE.ConeGeometry(0.75, 0.6, 4), s.m.ridge, M(0, 2.8, 0, Math.PI / 4));
}

// Arched marble bridge with railings, running along x.
function bridge(c: Ctx, len: number, width: number) {
  const pts: THREE.Vector3[] = [];
  const K = 8;
  for (let i = 0; i <= K; i++) pts.push(new THREE.Vector3(-len / 2 + (i * len) / K, 0.5 + Math.sin((Math.PI * i) / K) * 1.5, 0));
  for (let i = 0; i < K; i++) beam(c, pts[i], pts[i + 1], width, 0.35, c.m.marble);
  for (const sz of [-1, 1]) railing(c, pts.map((p) => p.clone().add(new THREE.Vector3(0, 0.15, (sz * width) / 2))), 0.7, c.m.marble);
}

function pool(c: Ctx, rand: () => number, x: number, z: number, w: number, d: number, lotus: THREE.Vector3[]) {
  box(c, w + 1.2, 0.6, d + 1.2, c.m.marbleShade, x, 0, z);
  put(c, new THREE.BoxGeometry(w, 0.2, d), c.m.water, M(x, 0.55, z), false);
  railing(c, rect(w / 2 + 0.4, d / 2 + 0.4, 0.6).map((p) => p.add(new THREE.Vector3(x, 0, z))), 0.7, c.m.marble, true);
  for (let i = 0; i < 26; i++) lotus.push(new THREE.Vector3(x + (rand() - 0.5) * (w - 1), 0.68, z + (rand() - 0.5) * (d - 1)));
}

/* ---------- nature ---------- */

export type TreeKind = "maple" | "green" | "pine" | "bamboo";

export function trees(rand: () => number, spots: { p: THREE.Vector3; kind: TreeKind }[]) {
  const g = new THREE.Group();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const inst = (geo: THREE.BufferGeometry, color: number, max: number) => {
    const im = new THREE.InstancedMesh(geo, toon(color), max);
    im.count = 0;
    im.castShadow = true;
    g.add(im);
    return im;
  };
  const trunk = inst(new THREE.CylinderGeometry(0.3, 0.55, 4, 6), 0x5c3e2b, spots.length);
  const blob = new THREE.IcosahedronGeometry(2.4, 0);
  const leaf = { maple: inst(blob, 0xd9733a, 400), mapleDark: inst(blob, 0xb4482f, 300), green: inst(blob, 0x6aaa4c, 400), greenDark: inst(blob, 0x3f7d3a, 300) };
  const pine = inst(new THREE.ConeGeometry(2.6, 3.4, 7), 0x2f5f3e, 400);
  const stalk = inst(new THREE.CylinderGeometry(0.09, 0.11, 9, 5), 0x7fa850, 600);
  const bleaf = inst(new THREE.IcosahedronGeometry(1, 0), 0x5e9a45, 600);
  const add = (im: THREE.InstancedMesh, x: number, y: number, z: number, s: number, rot = true) => {
    if (im.count >= im.instanceMatrix.count) return;
    q.setFromEuler(new THREE.Euler(rot ? rand() * 3 : 0, rand() * 3, rot ? rand() * 3 : 0));
    m4.compose(p.set(x, y, z), q, sc.setScalar(s));
    im.setMatrixAt(im.count++, m4);
  };
  for (const { p: v, kind } of spots) {
    const k = 0.75 + rand() * 0.7;
    if (kind === "pine") {
      add(trunk, v.x, v.y + 2 * k, v.z, k, false);
      for (let j = 0; j < 4; j++) add(pine, v.x, v.y + (3.5 + j * 1.7) * k, v.z, k * (1.25 - j * 0.22), false);
    } else if (kind === "bamboo") {
      for (let j = 0; j < 7; j++) {
        const bx = v.x + (rand() - 0.5) * 3, bz = v.z + (rand() - 0.5) * 3, hh = 0.8 + rand() * 0.5;
        stalk.count < 600 && (q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.15, 0, (rand() - 0.5) * 0.15)), m4.compose(p.set(bx, v.y + 4.5 * hh, bz), q, sc.set(1, hh, 1)), stalk.setMatrixAt(stalk.count++, m4));
        for (let l = 0; l < 3; l++) add(bleaf, bx + (rand() - 0.5) * 1.6, v.y + (6 + rand() * 3.5) * hh, bz + (rand() - 0.5) * 1.6, 0.7 + rand() * 0.5);
      }
    } else {
      add(trunk, v.x, v.y + 2 * k, v.z, k, false);
      const light = kind === "maple" ? leaf.maple : leaf.green, dark = kind === "maple" ? leaf.mapleDark : leaf.greenDark;
      for (let j = 0; j < 3; j++) add(light, v.x + (rand() - 0.5) * 3 * k, v.y + (4.6 + rand() * 1.8) * k, v.z + (rand() - 0.5) * 3 * k, k * (0.8 + rand() * 0.45));
      for (let j = 0; j < 2; j++) add(dark, v.x + (rand() - 0.5) * 3.6 * k, v.y + (3.4 + rand()) * k, v.z + (rand() - 0.5) * 3.6 * k, k);
    }
  }
  g.children.forEach((im) => ((im as THREE.InstancedMesh).instanceMatrix.needsUpdate = true));
  return g;
}

// Tall karst rock peaks like the ones in xianxia paintings.
function peaks(c: Ctx, rand: () => number) {
  const col = new THREE.Color();
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * (0.9 + rand() * 1.2) + (i % 3 === 0 ? Math.PI : 0); // mostly behind the palace
    const r = 150 + rand() * 110;
    const h = 70 + rand() * 110;
    const geo = new THREE.CylinderGeometry(2 + rand() * 4, 13 + rand() * 12, h, 8, 10);
    const pos = geo.attributes.position;
    const ph = rand() * 6, lean = (rand() - 0.5) * 12;
    const colors: number[] = [];
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      const t = y / h + 0.5, ang = Math.atan2(z, x);
      const s = 1 + 0.22 * Math.sin(y * 0.09 + ph) + 0.14 * Math.sin(ang * 3 + y * 0.05 + ph);
      pos.setXYZ(k, x * s + lean * t * t, y, z * s);
      col.set(t > 0.85 ? 0xc9c4b8 : t > 0.35 ? 0xa39e93 : 0x7d8a6e);
      colors.push(col.r, col.g, col.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.deleteAttribute("uv");
    geo.computeVertexNormals();
    put(c, geo, c.m.rock, M(Math.cos(a) * r, h / 2 - 6, Math.sin(a) * r, rand() * 3));
  }
}

// Far mountain silhouettes, like the paler layers of an ink painting.
export function mountains(rand: () => number, tint: number) {
  const g = new THREE.Group();
  const layers = [
    { r: 440, base: 90, amp: 160, low: 0x9fb4c8, mid: 0xc4d2df, snow: 0xf7f9fc },
    { r: 360, base: 50, amp: 110, low: 0x86a0ad, mid: 0xaabcc6, snow: 0xf2f5f8 },
    { r: 300, base: 16, amp: 40, low: 0x6f9466, mid: 0x86a87a, snow: 0xa6c492 },
  ];
  const SEG = 160;
  const tintC = new THREE.Color(tint);
  for (const L of layers) {
    const waves = Array.from({ length: 4 }, (_, i) => ({ f: 2 + i * 3 + Math.floor(rand() * 4), p: rand() * 6.28, a: 1 / (i + 1) }));
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const c = new THREE.Color();
    for (let i = 0; i <= SEG; i++) {
      const t = (i / SEG) * Math.PI * 2;
      let n = 0;
      for (const w of waves) n += Math.abs(Math.sin(t * w.f + w.p)) * w.a;
      const h = L.base + L.amp * Math.pow(n / 2.1, 1.6);
      const x = Math.cos(t) * L.r, z = Math.sin(t) * L.r;
      [-20, h * 0.55, h * 0.8, h].forEach((y, k) => {
        pos.push(x, y, z);
        c.set(k < 2 ? L.low : h > L.base + L.amp * 0.45 ? L.snow : L.mid).multiply(tintC);
        col.push(c.r, c.g, c.b);
      });
    }
    for (let i = 0; i < SEG; i++)
      for (let k = 0; k < 3; k++) {
        const a0 = i * 4 + k, b0 = (i + 1) * 4 + k;
        idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false })));
  }
  return g;
}

export function softTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,0.9)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function skyTexture(stops: [string, string, string] = ["#6fa8d6", "#bcd8ec", "#f4ecdc"]) {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const x = c.getContext("2d")!;
  const gr = x.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, stops[0]);
  gr.addColorStop(0.55, stops[1]);
  gr.addColorStop(1, stops[2]);
  x.fillStyle = gr;
  x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- the whole compound ---------- */

// bare = only the walled compound and its courtyard trees (no ground, peaks, far mountains, mist or leaves),
// for placing several palaces on the world map.
export function buildPalace(clan: string, env: Env, overrides: Partial<PalaceStyle> = {}, { bare = false } = {}) {
  const s = { ...styleFor(clan), ...overrides };
  const rand = rngFrom(clan + ":layout");
  const root = new THREE.Group();
  const b = new Builder();
  const c: Ctx = { b, T: new THREE.Matrix4(), m: materials(s, env) };
  const lotus: THREE.Vector3[] = [];

  // ground with gentle hills outside the walls
  const ground = new THREE.PlaneGeometry(700, 700, 70, 70);
  ground.rotateX(-Math.PI / 2);
  const gp = ground.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i), d = Math.hypot(x, z);
    if (d > 75) gp.setY(i, Math.sin(x * 0.03) * Math.cos(z * 0.025) * 9 * Math.min(1, (d - 75) / 60) + (rand() - 0.5) * 1.2);
  }
  ground.computeVertexNormals();
  if (!bare) b.add(ground, c.m.grass, new THREE.Matrix4(), false);
  else ground.dispose();

  // paved courtyard (texture repeats every 4 m)
  const pave = new THREE.BoxGeometry(84, 0.3, 100);
  const puv = pave.attributes.uv;
  for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * 21, puv.getY(i) * 25);
  b.add(pave, c.m.paving, M(0, 0.15, 0), false);
  box(c, 6, 0.12, 74, c.m.marbleShade, 0, 0.3, 10, 0, false); // central path

  // main pagoda on a three-step marble terrace with railings
  const tz = -14;
  for (let i = 0; i < 3; i++) {
    const w = 40 - i * 6, d = 32 - i * 6, y = i * 1.2;
    box(c, w, 1.2, d, i % 2 ? c.m.marbleShade : c.m.marble, 0, y, tz);
    const e = rect(w / 2 - 0.3, d / 2 - 0.3, y + 1.2).map((p) => p.add(new THREE.Vector3(0, 0, tz)));
    railing(c, [new THREE.Vector3(3, e[0].y, e[0].z), e[1], e[2], e[3], e[0], new THREE.Vector3(-3, e[0].y, e[0].z)], 0.8, c.m.marble);
  }
  stairs(c, 6, 3.6, 9, 0, 0, tz + 16 + 6); // grand stairs
  const main = sub(c, M(0, 3.6, tz));
  hall(main, 16, 16, { tiers: s.mainTiers, wallH: 5, double: true, plinth: true, spire: true });

  // hall behind the pagoda
  hall(sub(c, M(0, 0.3, -42)), 30, 9, { wallH: 4.6, double: true });

  // front gate hall
  hall(sub(c, M(0, 0.3, 44)), 24, 9, { wallH: 5, double: true });

  // long side halls
  for (const sx of [-1, 1]) hall(sub(c, M(sx * 33, 0.3, 4, 0)), 9, 34, { wallH: 4 });

  // pools with lotus, bridges and corner pavilions
  for (const sx of [-1, 1]) {
    pool(c, rand, sx * 14, 20, 16, 11, lotus);
    bridge(sub(c, M(sx * 14, 0.3, 20)), 18, 2.6);
    pavilion(sub(c, M(sx * 24, 0.3, 30)), 3);
  }

  // side towers
  const towers = s.sideTowers === 4 ? [[-26, -22], [26, -22], [-26, -36], [26, -36]] : s.sideTowers === 2 ? [[-26, -26], [26, -26]] : [];
  for (const [x, z] of towers) hall(sub(c, M(x, 0.3, z)), 7, 7, { tiers: Math.max(3, s.mainTiers - 2), wallH: 3.6, spire: true });

  // stone lanterns along the path
  for (let z = 4; z <= 36; z += 8) for (const sx of [-1, 1]) lantern(c, sx * 5, z);

  // outer wall with a tiled cap and small corner towers
  const walls: [number, number, number, number][] = [[0, -50, 86, 1.6], [-42, 0, 1.6, 100], [42, 0, 1.6, 100], [-27, 50, 30, 1.6], [27, 50, 30, 1.6]];
  for (const [x, z, w, d] of walls) {
    box(c, w, 3.8, d, c.m.wallPlain, x, 0, z);
    box(c, w + 1.2, 0.7, d + 1.2, c.m.ridge, x, 3.8, z);
  }
  for (const [x, z] of [[-42, -50], [42, -50], [-42, 50], [42, 50]]) {
    box(c, 6, 4.6, 6, c.m.wallPlain, x, 0, z);
    hall(sub(c, M(x, 4.6, z)), 4.5, 4.5, { wallH: 3, plinth: false });
  }

  // clan banners by the gate
  for (const sx of [-1, 1]) {
    box(c, 0.3, 11, 0.3, c.m.wood, sx * 17, 0, 56);
    put(c, new THREE.PlaneGeometry(2.6, 6), c.m.banner, M(sx * 17 + 1.45, 7.5, 56), false);
  }

  if (!bare) peaks(c, rand);
  b.finish(root);

  // lotus pads and flowers
  const pads = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 9), toon(0x4f9a4a), lotus.length);
  const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.28, 0), toon(0xf2a7c0), lotus.length);
  const m4 = new THREE.Matrix4();
  lotus.forEach((p, i) => {
    pads.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z));
    flowers.setMatrixAt(i, m4.makeTranslation(p.x + 0.2, p.y + 0.25, p.z + 0.1));
  });
  flowers.count = Math.floor(lotus.length / 3);
  root.add(pads, flowers);

  // trees: maples, pines and bamboo around the walls, a few inside
  const spots: { p: THREE.Vector3; kind: TreeKind }[] = [];
  const kindAt = (): TreeKind => {
    const r = rand();
    return r < s.autumn * 0.5 ? "maple" : r < 0.6 ? "green" : r < 0.85 ? "pine" : "bamboo";
  };
  for (let i = 0; i < (bare ? 0 : 90); i++) {
    const a = rand() * Math.PI * 2, r = 56 + rand() * 60;
    spots.push({ p: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r * 1.1), kind: kindAt() });
  }
  for (const [x, z] of [[-34, -44], [34, -44], [-20, 38], [20, 38], [-36, 30], [36, 30], [-14, -34], [14, -34]])
    spots.push({ p: new THREE.Vector3(x, 0.3, z), kind: rand() < 0.5 ? "maple" : "pine" });
  root.add(trees(rand, spots));

  // moss creeping over roofs in overgrown sects
  const mossN = Math.floor(160 * s.greenery);
  const moss = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.7, 0), toon(0x5a9a44), mossN);
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < mossN; i++) {
    const spot = [[0, 12, -14, 14], [0, 7, -42, 16], [0, 7, 44, 13], [-33, 6, 4, 6], [33, 6, 4, 6]][i % 5];
    q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
    m4.compose(p.set(spot[0] + (rand() - 0.5) * spot[3] * 2, spot[1] + rand() * 2, spot[2] + (rand() - 0.5) * spot[3]), q, sc.set(0.8 + rand(), 0.25 + rand() * 0.2, 0.8 + rand()));
    moss.setMatrixAt(i, m4);
  }
  root.add(moss);

  if (bare) return { root, style: s, tick: () => {} };
  root.add(mountains(rand, env.mountainTint));

  // drifting mist
  const tex = softTexture();
  const mist = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: env.fog, transparent: true, opacity: 0.4, depthWrite: false }));
    const a = rand() * Math.PI * 2, r = 130 + rand() * 120;
    sp.position.set(Math.cos(a) * r, 10 + rand() * 25, Math.sin(a) * r);
    sp.scale.setScalar(60 + rand() * 60);
    mist.add(sp);
  }
  root.add(mist);

  // falling leaves
  const LEAVES = 60;
  const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.7, 0.3), new THREE.MeshBasicMaterial({ color: s.autumn > 0.4 ? 0xd9733a : 0x7cc05a, side: THREE.DoubleSide }), LEAVES);
  const lp = Array.from({ length: LEAVES }, () => ({ x: (rand() - 0.5) * 120, y: rand() * 40, z: (rand() - 0.5) * 120, s: rand() * 6 }));
  root.add(leaves);
  const tick = (t: number, dt: number) => {
    mist.children.forEach((m, i) => (m.position.x += Math.sin(t * 0.1 + i) * 0.02));
    lp.forEach((l, i) => {
      l.y -= dt * 2.2;
      l.x += dt * (3 + Math.sin(t + l.s) * 2);
      l.z += dt * Math.cos(t * 0.7 + l.s);
      if (l.y < 0) { l.y = 40; l.x = (rand() - 0.5) * 120 - 20; }
      q.setFromEuler(new THREE.Euler(t * 2 + l.s, t + l.s, t * 1.5));
      m4.compose(p.set(l.x, l.y, l.z), q, sc.setScalar(1));
      leaves.setMatrixAt(i, m4);
    });
    leaves.instanceMatrix.needsUpdate = true;
  };

  return { root, style: s, tick };
}

/* ---------- battlefields (mode select) ---------- */

export type ArenaKind = "brawl" | "classic" | "rank" | "training";

// Small fighting grounds in the same ink-and-paint style as the palaces, one per battle mode.
export function buildArena(kind: ArenaKind, env: Env) {
  const style: Record<ArenaKind, Partial<PalaceStyle>> = {
    brawl: { wall: 0x8e2f2a, roof: 0x34394a, banner: 0xc8372d, autumn: 0.8 },
    classic: { wall: 0xb23a2e, roof: 0x2f6d6b, banner: 0x3fbf8a, autumn: 0.5 },
    rank: { wall: 0x3a3f5c, roof: 0x4d5562, banner: 0xe8b84a, autumn: 0 },
    training: { wall: 0xa4432c, roof: 0x3d6b5f, banner: 0x3fbf8a, autumn: 0.2 },
  };
  const s = { ...styleFor(kind), ...style[kind] };
  const rand = rngFrom("arena:" + kind);
  const root = new THREE.Group();
  const b = new Builder();
  const c: Ctx = { b, T: new THREE.Matrix4(), m: materials(s, env) };
  const spots: { p: THREE.Vector3; kind: TreeKind }[] = [];
  const ring = (n: number, r: number, y: number, rot = Math.PI / n) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + rot;
      return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    });
  const grass = (size = 400) => {
    const g = new THREE.PlaneGeometry(size, size, 40, 40);
    g.rotateX(-Math.PI / 2);
    const gp = g.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), z = gp.getZ(i), d = Math.hypot(x, z);
      if (d > 40) gp.setY(i, Math.sin(x * 0.05) * Math.cos(z * 0.04) * 6 * Math.min(1, (d - 40) / 40));
    }
    g.computeVertexNormals();
    b.add(g, c.m.grass, new THREE.Matrix4(), false);
  };
  const pole = (x: number, z: number, h: number, flag: THREE.Material, side = 1) => {
    box(c, 0.3, h, 0.3, c.m.wood, x, 0, z);
    put(c, new THREE.PlaneGeometry(2, 4.6), flag, M(x + side * 1.15, h - 2.8, z, 0), false);
  };
  const gate = (z: number, w: number, h: number) => {
    for (const sx of [-1, 1]) {
      box(c, 0.9, 0.6, 0.9, c.m.marble, sx * w / 2, 0, z);
      put(c, new THREE.CylinderGeometry(0.4, 0.45, h, 10), c.m.wallPlain, M(sx * w / 2, h / 2, z), false);
    }
    box(c, w + 2, 0.7, 0.8, c.m.wood, 0, h - 1.4, z);
    box(c, w + 1, 0.5, 0.6, c.m.trim, 0, h - 2.4, z);
    roofRect(sub(c, M(0, 0, z)), w + 1, 1.2, h - 0.7, 0.5, 1.2, 1.0);
  };

  if (kind === "brawl") {
    // Bamboo Ring: an octagonal stone ring with lantern posts and ropes, deep in a bamboo grove
    grass();
    put(c, new THREE.CylinderGeometry(13, 14, 1.4, 8), c.m.marble, M(0, 0.7, 0, Math.PI / 8));
    put(c, new THREE.CylinderGeometry(11.6, 11.6, 0.12, 8), c.m.paving, M(0, 1.46, 0, Math.PI / 8), false);
    put(c, new THREE.TorusGeometry(5, 0.18, 4, 32), c.m.banner, M(0, 1.55, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), false);
    for (let i = 0; i < 4; i++) stairs(sub(c, M(0, 0, 0, (i * Math.PI) / 2)), 4, 1.4, 2.4, 0, 0, 15.6);
    const posts = ring(8, 12.4, 1.4);
    posts.forEach((p) => {
      box(c, 0.45, 3.6, 0.45, c.m.rail, p.x, p.y, p.z);
      box(c, 0.8, 0.8, 0.8, c.m.lamp, p.x, p.y + 3.6, p.z);
      put(c, new THREE.ConeGeometry(0.75, 0.6, 4), c.m.ridge, M(p.x, p.y + 4.7, p.z, Math.PI / 4));
    });
    for (const h of [1.3, 2.4]) posts.forEach((p, i) => beam(c, p.clone().setY(p.y + h), posts[(i + 1) % 8].clone().setY(p.y + h), 0.12, 0.12, c.m.banner, false));
    for (const sx of [-1, 1]) {
      const d = sub(c, M(sx * 17, 0, -6));
      put(d, new THREE.CylinderGeometry(1.5, 1.5, 2.2, 14), c.m.banner, M(0, 2.4, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
      box(d, 0.3, 1.4, 2.4, c.m.wood, -0.6, 0, 0);
      box(d, 0.3, 1.4, 2.4, c.m.wood, 0.6, 0, 0);
    }
    gate(-22, 9, 8);
    for (let i = 0; i < 60; i++) {
      const a = rand() * Math.PI * 2, r = 24 + rand() * 40;
      spots.push({ p: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), kind: i % 5 === 0 ? "maple" : "bamboo" });
    }
  } else if (kind === "classic") {
    // Courtyard Duel: a paved court between two halls, jade banners on one side, red on the other
    grass();
    const pave = new THREE.BoxGeometry(34, 0.4, 26);
    const puv = pave.attributes.uv;
    for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * 8, puv.getY(i) * 6);
    b.add(pave, c.m.paving, M(0, 0.2, 0), false);
    box(c, 36, 0.3, 1, c.m.marble, 0, 0, 13.5);
    box(c, 36, 0.3, 1, c.m.marble, 0, 0, -13.5);
    railing(c, rect(17.5, 13, 0.4), 0.8, c.m.marble, true);
    box(c, 0.4, 0.05, 20, c.m.trim, 0, 0.4, 0, 0, false);
    hall(sub(c, M(0, 0.4, -20)), 18, 8, { wallH: 4.6, double: true, tiers: 2, spire: true });
    gate(17, 10, 8.5);
    const jade = toon(0x3fbf8a, undefined, { side: THREE.DoubleSide });
    const red = toon(0xc8372d, undefined, { side: THREE.DoubleSide });
    for (let z = -9; z <= 9; z += 6) {
      pole(-19.5, z, 10, jade, 1);
      pole(19.5, z, 10, red, -1);
    }
    for (const [x, z] of [[-10, 10], [10, 10], [-10, -10], [10, -10]]) lantern(c, x, z);
    for (let i = 0; i < 40; i++) {
      const a = rand() * Math.PI * 2, r = 30 + rand() * 40;
      spots.push({ p: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), kind: rand() < 0.5 ? "maple" : "pine" });
    }
  } else if (kind === "rank") {
    // Peak of Heaven: a round platform on a lone rock pillar above the clouds, a pagoda behind it
    const col = new THREE.Color();
    const rockGeo = new THREE.CylinderGeometry(17, 7, 120, 10, 12);
    const pos = rockGeo.attributes.position, colors: number[] = [];
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      const sc = 1 + 0.2 * Math.sin(y * 0.1) + 0.12 * Math.sin(Math.atan2(z, x) * 3 + y * 0.06);
      pos.setXYZ(k, x * sc, y, z * sc);
      col.set(y > 50 ? 0x7d8a6e : 0xa39e93);
      colors.push(col.r, col.g, col.b);
    }
    rockGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    rockGeo.deleteAttribute("uv");
    rockGeo.computeVertexNormals();
    put(c, rockGeo, c.m.rock, M(0, -60, 0));
    put(c, new THREE.CylinderGeometry(16, 16.5, 1.2, 24), c.m.marble, M(0, 0.6, 0));
    put(c, new THREE.CylinderGeometry(10, 10, 0.1, 24), c.m.paving, M(0, 1.25, 0), false);
    put(c, new THREE.TorusGeometry(10, 0.25, 4, 40), c.m.trim, M(0, 1.3, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), false);
    railing(c, ring(24, 15.6, 1.2), 0.9, c.m.marble, true);
    hall(sub(c, M(0, 1.2, -10)), 7, 7, { tiers: 5, wallH: 3.6, spire: true, plinth: true });
    for (const p of ring(6, 13, 1.2, Math.PI / 2 + 0.3)) if (p.z > -6) lantern(c, p.x, p.z);
    for (const sx of [-1, 1]) pole(sx * 9, 8, 11, c.m.banner, sx);
    // smaller rock pillars around in the sea of clouds
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand(), r = 50 + rand() * 60, h = 30 + rand() * 50;
      const g = new THREE.CylinderGeometry(2 + rand() * 3, 8 + rand() * 6, h, 8, 6);
      const gp = g.attributes.position, cc: number[] = [];
      for (let k = 0; k < gp.count; k++) {
        const y = gp.getY(k);
        col.set(y > h * 0.4 ? 0x7d8a6e : 0xa39e93);
        cc.push(col.r, col.g, col.b);
      }
      g.setAttribute("color", new THREE.Float32BufferAttribute(cc, 3));
      g.deleteAttribute("uv");
      g.computeVertexNormals();
      put(c, g, c.m.rock, M(Math.cos(a) * r, h / 2 - 40 - rand() * 20, Math.sin(a) * r, rand() * 3));
    }
    for (let i = 0; i < 8; i++) {
      const p = ring(8, 30 + rand() * 30, 0)[i];
      spots.push({ p: p.setY(-20 - rand() * 10), kind: "pine" });
    }
  } else {
    // Training Ground: a sand yard with wooden dummies, stone weights and a small hall
    grass();
    const sand = toon(0xd8c39a);
    box(c, 30, 0.3, 24, sand, 0, 0, 0, 0, false);
    railing(c, rect(15, 12, 0.3), 1.0, c.m.wood, true);
    hall(sub(c, M(0, 0.3, -18)), 14, 7, { wallH: 4.2 });
    for (let i = 0; i < 6; i++) {
      const x = -10 + (i % 3) * 10, z = i < 3 ? -4 : 5;
      put(c, new THREE.CylinderGeometry(0.55, 0.6, 3.6, 10), c.m.wood, M(x, 2.1, z));
      for (const [h, ry] of [[2.8, 0.5], [2.8, -0.5], [1.9, 0]] as const)
        put(c, new THREE.BoxGeometry(1.6, 0.18, 0.18), c.m.wood, M(x + Math.sin(ry) * 0.6, h, z + 0.6, ry + Math.PI / 2));
      box(c, 1.6, 0.3, 1.6, c.m.marbleShade, x, 0.3, z);
    }
    for (let i = 0; i < 4; i++) {
      put(c, new THREE.CylinderGeometry(0.9, 0.9, 0.5, 12), c.m.marbleShade, M(11 + (i % 2) * 2.2, 0.55, 8 - Math.floor(i / 2) * 2.2));
    }
    box(c, 0.25, 3.2, 4, c.m.rail, -13, 0.3, 8);
    for (let k = 0; k < 5; k++) put(c, new THREE.CylinderGeometry(0.08, 0.08, 4.2, 5), c.m.wood, M(-12.6, 2.4, 6.4 + k * 0.8).multiply(new THREE.Matrix4().makeRotationZ(0.12)), false);
    gate(14, 8, 7);
    for (let i = 0; i < 50; i++) {
      const a = rand() * Math.PI * 2, r = 26 + rand() * 45;
      spots.push({ p: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), kind: rand() < 0.6 ? "pine" : "green" });
    }
  }

  if (kind !== "rank") peaks(c, rand);
  b.finish(root);
  root.add(trees(rand, spots));
  root.add(mountains(rand, env.mountainTint));

  // drifting mist (a sea of clouds under the Peak of Heaven)
  const tex = softTexture();
  const mist = new THREE.Group();
  const N = kind === "rank" ? 40 : 12;
  for (let i = 0; i < N; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: kind === "rank" ? 0xdfe6f5 : env.fog, transparent: true, opacity: kind === "rank" ? 0.55 : 0.35, depthWrite: false }));
    const a = rand() * Math.PI * 2, r = kind === "rank" ? 20 + rand() * 120 : 90 + rand() * 80;
    sp.position.set(Math.cos(a) * r, kind === "rank" ? -12 - rand() * 10 : 8 + rand() * 18, Math.sin(a) * r);
    sp.scale.setScalar(kind === "rank" ? 50 + rand() * 40 : 50 + rand() * 40);
    mist.add(sp);
  }
  root.add(mist);
  const tick = (t: number) => {
    mist.children.forEach((m, i) => (m.position.x += Math.sin(t * 0.1 + i) * 0.03));
  };
  return { root, tick };
}
