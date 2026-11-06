import * as THREE from "three";
import {
  Builder, M, put, sub, box, stairs, beam, railing, rect, materials, styleFor, rngFrom, canvasTex, css,
  roofTexture, roofFromFaces, toon, trees, mountains, softTexture, type Ctx, type TreeKind,
} from "./buildPalace";
import type { Env } from "./weather";

// Arasaka Citadel: a black fortress stepped up a basalt crag.
// Three stone terraces (gate court, barracks yard, keep platform) behind a battered, crenellated wall,
// a gatehouse between two towers, and the Thunder Keep with two watchtowers joined by covered sky bridges.
//
// Every building is put together the way a real one is, so nothing floats:
// floor slab -> pillars and wall shell standing on it -> beam band on the pillars -> eave roof rising
// from the band straight into the next floor's slab. Walls are thin shells with empty floors inside,
// ready for rooms and stairs later. Units are metres; the gate faces +z.

const BAY = 3.2;
export const ARASAKA_SIZE = { halfW: 80, front: 84, back: -130, keepTop: 100 };

/* ---------- textures ---------- */

function basaltTexture() {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = "#3a3940";
    x.fillRect(0, 0, w, h);
    const r = rngFrom("basalt");
    // staggered dressed blocks
    for (let row = 0; row < 8; row++) {
      const y = row * 32, off = row % 2 ? 24 : 0;
      for (let col = -1; col < 6; col++) {
        const bx = col * 48 + off;
        const k = 0.85 + r() * 0.3;
        x.fillStyle = css(0x3a3940, k);
        x.fillRect(bx + 2, y + 2, 44, 28);
        x.fillStyle = "rgba(255,255,255,0.05)";
        x.fillRect(bx + 2, y + 2, 44, 3);
      }
    }
    x.fillStyle = "#222127";
    for (let row = 0; row <= 8; row++) x.fillRect(0, row * 32 - 1, w, 3);
  });
}

// black lacquer bay: red pillars at the sides, a red lattice window glowing faintly, iron frieze on top
function wallTexture() {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = "#18161b";
    x.fillRect(0, 0, w, h);
    x.fillStyle = "#26232a";
    x.fillRect(0, 0, w, h * 0.14);
    x.fillStyle = "#8e1f19";
    for (let i = 0; i < 6; i++) {
      x.beginPath();
      const cx = i * 44 + 22, cy = h * 0.07;
      x.moveTo(cx, cy - 10); x.lineTo(cx + 10, cy); x.lineTo(cx, cy + 10); x.lineTo(cx - 10, cy);
      x.fill();
    }
    x.fillStyle = "#6e1813";
    x.fillRect(0, h * 0.14, 22, h);
    x.fillRect(w - 22, h * 0.14, 22, h);
    const px = 46, pw = w - 92, py = h * 0.24, ph = h * 0.56;
    const g = x.createLinearGradient(0, py, 0, py + ph);
    g.addColorStop(0, "#3d0f0b");
    g.addColorStop(1, "#5a1a10");
    x.fillStyle = g;
    x.fillRect(px, py, pw, ph);
    x.strokeStyle = "#a3291f";
    x.lineWidth = 3;
    for (let gx = px + 12; gx < px + pw; gx += 12) { x.beginPath(); x.moveTo(gx, py); x.lineTo(gx, py + ph); x.stroke(); }
    for (let gy = py + 12; gy < py + ph; gy += 12) { x.beginPath(); x.moveTo(px, gy); x.lineTo(px + pw, gy); x.stroke(); }
    x.strokeStyle = "#0d0b0e";
    x.lineWidth = 6;
    x.strokeRect(px, py, pw, ph);
    x.fillStyle = "#2c2a30";
    x.fillRect(0, h * 0.9, w, h * 0.1);
  });
}

function mats(env: Env) {
  const m = materials({ ...styleFor("Arasaka"), wall: 0x18161b, roof: 0x2a2d36, banner: 0xc8372d, trim: 0x8a6a3a }, env);
  const stoneTex = basaltTexture();
  const wallTex = wallTexture();
  return {
    ...m,
    // the red lattice windows glow from the lamps inside (the black lacquer stays dark)
    wall: toon(0, wallTex, { emissive: 0xff3a2a, emissiveMap: wallTex, emissiveIntensity: 1.1 + env.lamp * 0.5 }),
    wallPlain: toon(0x1c1a1f),
    roof: toon(0, roofTexture(0x2b2f39), { side: THREE.DoubleSide }),
    ridge: toon(0x18191e),
    marble: toon(0x4a4850), // steps and slabs: dark dressed stone
    marbleShade: toon(0x38363d),
    paving: toon(0, stoneTex),
    stone: toon(0, stoneTex),
    stoneDark: toon(0x2c2b31),
    wood: toon(0x231a17),
    rail: toon(0x5c1713),
    pillar: toon(0x7e1c17),
    bracket: toon(0x3a1512),
    trim: toon(0x7a6040),
    iron: toon(0x2e3138),
    sand: toon(0x6b6256),
    fire: new THREE.MeshBasicMaterial({ color: 0xff7a2a }),
    grass: toon(0x46594a),
    rock: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: m.rock.gradientMap }),
  };
}
type AMats = ReturnType<typeof mats>;

/* ---------- collision map (for walking around) ---------- */

// Boxes are axis-aligned in citadel space. walk = you can stand on its top, and it blocks you from the side
// if its top is higher than a step; solid = blocks you whenever your body overlaps it in height.
export type Box = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number };
// stairs: height rises from a (low end) to b (high end), across width w
export type Ramp = { ax: number; az: number; bx: number; bz: number; w: number; ya: number; yb: number };
export type Door = { pivot: THREE.Group; base: THREE.Quaternion; sign: number; open: number; target: number; at: THREE.Vector3; box: Box };
// roofs: ceilings and roofs overhead (no effect on walking; rain stops on them, and you're indoors under one)
// a lift: a platform riding a shaft; gates on each floor stay shut unless the platform is there
export type Lift = { x0: number; x1: number; z0: number; z1: number; stops: number[]; gates: { box: Box; stop: number }[]; at: number };
export type Collision = { walk: Box[]; solid: Box[]; ramps: Ramp[]; doors: Door[]; roofs: Box[]; lifts: Lift[] };
type ACtx = Ctx & { m: AMats; col: Collision };

const _v = new THREE.Vector3();
// world-space box of a local box (w, h, d) standing at (x, y, z)
function aabb(c: ACtx, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): Box {
  const m = c.T.clone().multiply(M(x, y, z, ry));
  const b = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [0, 1]) {
    _v.set((sx * w) / 2, sy * h, (sz * d) / 2).applyMatrix4(m);
    b.x0 = Math.min(b.x0, _v.x); b.x1 = Math.max(b.x1, _v.x);
    b.z0 = Math.min(b.z0, _v.z); b.z1 = Math.max(b.z1, _v.z);
    b.y0 = Math.min(b.y0, _v.y); b.y1 = Math.max(b.y1, _v.y);
  }
  return b;
}
const walkBox = (c: ACtx, w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0) => c.col.walk.push(aabb(c, w, h, d, x, y, z, ry));
const solidBox = (c: ACtx, w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0) => c.col.solid.push(aabb(c, w, h, d, x, y, z, ry));

// a railing you can't walk through: the railing itself plus thin solid boxes along it.
// gaps: [centre along the segment (0..len), width] per segment index, where a path goes through
function fence(c: ACtx, pts: THREE.Vector3[], h: number, mat: THREE.Material, closed = false, gaps: Record<number, [number, number][]> = {}) {
  const path = closed ? [...pts, pts[0]] : pts;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], len = a.distanceTo(b), dir = b.clone().sub(a).normalize();
    // the pieces of this side between its gaps
    const cuts = (gaps[i] ?? []).map(([at, w]) => [at - w / 2, at + w / 2]).sort((p, q) => p[0] - q[0]);
    let from = 0;
    for (const [g0, g1] of [...cuts, [len, len]]) {
      if (g0 - from > 0.3) {
        const p = a.clone().addScaledVector(dir, from), q = a.clone().addScaledVector(dir, g0);
        railing(c, [p, q], h, mat);
        // short solid pieces, so a slanted side doesn't become one fat box
        const n = Math.max(1, Math.ceil((g0 - from) / 1.5)), ry = -Math.atan2(dir.z, dir.x);
        for (let k = 0; k < n; k++) {
          const m = p.clone().lerp(q, (k + 0.5) / n);
          solidBox(c, (g0 - from) / n, h + 0.15, 0.3, m.x, m.y, m.z, ry);
        }
      }
      from = g1;
    }
  }
}

// stairs plus their walking slope
function steps(c: ACtx, w: number, h: number, depth: number, x: number, y: number, z: number) {
  stairs(c, w, h, depth, x, y, z);
  // a solid landing slab from the top step back into the wall behind it: battered walls lean back,
  // so without it there's an open gap between the last step and the floor above
  box(c, w + 1, h, 1.6, c.m.marble, x, y, z - depth - 0.8, 0, false);
  walkBox(c, w, h, 1.6, x, y, z - depth - 0.8);
  // the walking ramp runs a little past the top step onto the landing, so there's never a gap to fall into
  // the slope reaches full height exactly at the top step, then runs flat onto the landing
  const a = new THREE.Vector3(x, y, z + 0.3).applyMatrix4(c.T), b = new THREE.Vector3(x, y + h, z - depth).applyMatrix4(c.T);
  c.col.ramps.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, w, ya: a.y, yb: b.y });
  const f = new THREE.Vector3(x, y + h, z - depth - 1.6).applyMatrix4(c.T);
  c.col.ramps.push({ ax: b.x, az: b.z, bx: f.x, bz: f.z, w, ya: b.y, yb: f.y });
}

// a double door that swings inward (toward -z) when someone walks up; dw wide, dh tall, centred at (x, y, z)
function door(c: ACtx, dw: number, dh: number, x: number, y: number, z: number, mat: THREE.Material, studs = false) {
  for (const sx of [-1, 1]) {
    const hinge = c.T.clone().multiply(M(x + sx * (dw / 2), y, z));
    const pivot = new THREE.Group();
    hinge.decompose(pivot.position, pivot.quaternion, pivot.scale);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(dw / 2 - 0.05, dh, 0.18), mat);
    leaf.position.set((-sx * dw) / 4, dh / 2, 0);
    pivot.add(leaf);
    const ink = new THREE.LineSegments(new THREE.EdgesGeometry(leaf.geometry), new THREE.LineBasicMaterial({ color: 0x0d0b0e }));
    ink.position.copy(leaf.position);
    pivot.add(ink);
    if (studs)
      for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) {
        const st = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 4), c.m.iron);
        st.position.set((-sx * dw) / 4 + (k - 1) * (dw / 8), dh * (0.2 + r * 0.2), 0.12);
        pivot.add(st);
      }
    c.col.doors.push({
      pivot, base: pivot.quaternion.clone(), sign: -sx, open: 0, target: 0, // both leaves swing inward
      at: new THREE.Vector3(x, y + 1, z).applyMatrix4(c.T),
      box: aabb(c, dw, dh, 0.5, x, y, z),
    });
  }
}

// the Arasaka emblem (hexagon and lightning bolt, same drawing as the clan logo), lit so it shows in the storm
let emblemTex: THREE.CanvasTexture | null = null;
function emblem(c: ACtx, size: number, x: number, y: number, z: number, ry = 0) {
  emblemTex ??= canvasTex(192, 208, (g) => {
    g.scale(4, 4);
    g.lineJoin = "round";
    const hex = new Path2D("M24 1 46 13v26L24 51 2 39V13z");
    g.fillStyle = "#c8372d";
    g.fill(hex);
    g.strokeStyle = "#1b1a1f";
    g.lineWidth = 2.5;
    g.stroke(hex);
    g.strokeStyle = "rgba(255,255,255,0.4)";
    g.lineWidth = 1.5;
    g.stroke(new Path2D("M24 6 41 15.5v21L24 46 7 36.5v-21z"));
    const bolt = new Path2D("M27 9 14 29h9l-4 15 15-22h-9l4-13z");
    g.fillStyle = "#fff4e6";
    g.fill(bolt);
    g.strokeStyle = "#1b1a1f";
    g.lineWidth = 1.5;
    g.stroke(bolt);
  });
  emblemTex.wrapS = emblemTex.wrapT = THREE.ClampToEdgeWrapping;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 1.08), new THREE.MeshBasicMaterial({ map: emblemTex, transparent: true, alphaTest: 0.1, fog: false }));
  c.T.clone().multiply(M(x, y, z, ry)).decompose(mesh.position, mesh.quaternion, mesh.scale);
  return mesh;
}

/* ---------- stonework ---------- */

// stone block whose sides lean in by `batter` metres (castle-style sloped walls); textured in 4 m blocks
function stone(c: ACtx, w: number, h: number, d: number, x = 0, y = 0, z = 0, batter = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0 && batter) {
      p.setX(i, p.getX(i) - Math.sign(p.getX(i)) * batter);
      p.setZ(i, p.getZ(i) - Math.sign(p.getZ(i)) * batter);
    }
  }
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    const sx = face < 2 ? d : w, sy = face === 2 || face === 3 ? d : h;
    uv.setXY(i, (uv.getX(i) * sx) / 8, (uv.getY(i) * sy) / 8);
  }
  g.computeVertexNormals();
  put(c, g, c.m.stone, M(x, y + h / 2, z, ry));
  walkBox(c, w - batter, h, d - batter, x, y, z, ry);
}

// a defensive wall from a to b (on the ground): battered stone, walkway, merlons on the outer side
function rampart(c: ACtx, ax: number, az: number, bx: number, bz: number, h = 10, outer = 1) {
  const len = Math.hypot(bx - ax, bz - az), ry = -Math.atan2(bz - az, bx - ax);
  const s = sub(c, M((ax + bx) / 2, 0, (az + bz) / 2, ry)) as ACtx;
  stone(s, len, h, 7, 0, 0, 0, 1.2);
  box(s, len, 0.5, 4.8, s.m.stoneDark, 0, h, 0);
  const n = Math.floor(len / 3);
  for (let i = 0; i < n; i++) box(s, 1.6, 1.6, 1.0, s.m.stoneDark, -len / 2 + 1.5 + i * 3, h + 0.5, outer * 2.3, 0, i === 0);
  box(s, len, 1.0, 0.6, s.m.stoneDark, 0, h + 0.5, -outer * 2.2, 0, false); // low parapet inside
}

/* ---------- roofs ---------- */

// Eave roof from an outer rectangle (half sizes W, D) up to an inner one (iw, id) at height rise.
// With id = 0 it closes into a ridge (the top roof). Corners sweep up into iron horns.
function roof(c: ACtx, W: number, D: number, iw: number, id: number, y: number, rise: number, lift: number, horns = true) {
  const e = [new THREE.Vector3(-W, 0, D), new THREE.Vector3(W, 0, D), new THREE.Vector3(W, 0, -D), new THREE.Vector3(-W, 0, -D)];
  const i = [new THREE.Vector3(-iw, 0, id), new THREE.Vector3(iw, 0, id), new THREE.Vector3(iw, 0, -id), new THREE.Vector3(-iw, 0, -id)];
  const g = roofFromFaces([[e[0], e[1], i[0], i[1]], [e[1], e[2], i[1], i[2]], [e[2], e[3], i[2], i[3]], [e[3], e[0], i[3], i[0]]], rise, lift);
  put(c, g, c.m.roof, M(0, y, 0));
  // the roof is solid: each face is a walkable slope from the eave up to the inner edge (or ridge)
  const slope = (ax: number, az: number, bx: number, bz: number, w: number) => {
    const a = new THREE.Vector3(ax, y + 0.15, az).applyMatrix4(c.T), b = new THREE.Vector3(bx, y + rise + 0.15, bz).applyMatrix4(c.T);
    c.col.ramps.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, w, ya: a.y, yb: b.y });
  };
  slope(0, D, 0, id, W + iw);
  slope(0, -D, 0, -id, W + iw);
  slope(W, 0, iw, 0, D + id);
  slope(-W, 0, -iw, 0, D + id);
  // dark fascia so the eave has some thickness from below
  for (const [ax, az, bx, bz] of [[-W, D, W, D], [W, D, W, -D], [W, -D, -W, -D], [-W, -D, -W, D]])
    beam(c, new THREE.Vector3(ax, y - 0.25, az), new THREE.Vector3(bx, y - 0.25, bz), 0.35, 0.5, c.m.ridge, false);
  if (horns)
    for (const [sx, sz] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(sz * 0.75, 0, -sx * 0.75));
      put(c, new THREE.ConeGeometry(0.32, 2.6, 5), c.m.iron, new THREE.Matrix4().compose(new THREE.Vector3(sx * (W + 0.5), y + lift + 0.9, sz * (D + 0.5)), q, new THREE.Vector3(1, 1, 1)));
    }
}

/* ---------- buildings ---------- */

type Side = "x+" | "x-" | "z+" | "z-";
type BOpts = { shaft?: Rect; spiral?: boolean; openings?: { floor: number; side: Side; w: number }[]; floors: number; wallH?: number; shrink?: number; veranda?: number; door?: boolean; spire?: number; topRatio?: number; banners?: boolean; skin?: (f: number) => THREE.Material };

// A multi-storey hall or tower. Returns the height of each floor's walking surface (slab top), and the top.
// Buildings you can walk into get a stair to every floor (a straight flight along the back wall, or a
// spiral in small towers), a stairwell cut through the floor above, and a doorway out onto each balcony.
export function building(c: ACtx, w: number, d: number, o: BOpts) {
  const ver = o.veranda ?? 1.3, shrink = o.shrink ?? 0.84, floors: number[] = [], sizes: { w: number; d: number; h: number }[] = [];
  const inside = o.door !== false;
  let y = 0, cw = w, cd = d;
  let hole: Hole = null; // the stairwell coming up through this floor
  for (let f = 0; f < o.floors; f++) {
    const H = (o.wallH ?? 4.4) * (f === 0 ? 1.15 : 1);
    const sw = cw + 2 * ver + 0.6, sd = cd + 2 * ver + 0.6;
    // floor slab (the ground floor gets a stone podium with steps)
    if (f === 0) {
      stone(c, sw + 1.6, 1.4, sd + 1.6, 0, y, 0, 0.3);
      if (inside) steps(c, 4.6, 1.4, 2.2, 0, y, sd / 2 + 0.8 + 2.2);
      y += 1.4;
    } else {
      holedSlab(c, sw, 0.6, sd, y, [hole, o.shaft ?? null], c.m.wood, true);
      y += 0.6;
    }
    floors.push(y);
    sizes.push({ w: cw, d: cd, h: H });
    // wall shell: four thin walls. The ground floor has the front door; upper floors have open
    // doorways onto the balcony (front, plus any side a sky bridge lands on)
    const T = 0.4;
    const opens = (side: Side) => inside && f > 0 && (side === "z+" || (o.openings ?? []).some((q) => q.floor === f && q.side === side));
    const ddw = Math.min(2.4, cw * 0.3), ddh = Math.min(3, H - 0.8);
    const sk = o.skin?.(f);
    const wall = (side: Side, len: number, x: number, z: number, ry: number) => {
      if (sk) skin(c, len, H, x, y, z, T, sk, opens(side) ? [ddw, ddh] : null);
      return opens(side) ? doorway(c, len, H, x, y, z, ry, ddw, ddh) : wallPanel(c, len, H, x, y, z, ry);
    };
    wall("z-", cw, 0, -cd / 2 + T / 2, 0);
    wall("x-", cd, -cw / 2 + T / 2, 0, Math.PI / 2);
    wall("x+", cd, cw / 2 - T / 2, 0, Math.PI / 2);
    if (f === 0 && inside) {
      const dw = Math.min(3.2, cw * 0.3), dh = Math.min(3.6, H - 0.8), side = (cw - dw) / 2;
      if (sk) skin(c, cw, H, 0, y, cd / 2 - T / 2, T, sk, [dw, dh]);
      wallPanel(c, side, H, -cw / 2 + side / 2, y, cd / 2 - T / 2);
      wallPanel(c, side, H, cw / 2 - side / 2, y, cd / 2 - T / 2);
      box(c, dw, H - dh, T, c.m.wallPlain, 0, y + dh, cd / 2 - T / 2);
      solidBox(c, dw, H - dh, T, 0, y + dh, cd / 2 - T / 2);
      door(c, dw, dh, 0, y, cd / 2 - T / 2, c.m.pillar);
      box(c, dw + 0.8, 0.5, T + 0.3, c.m.pillar, 0, y + dh, cd / 2 - T / 2); // red lintel
      for (const sx of [-1, 1]) box(c, 0.45, dh, T + 0.3, c.m.pillar, sx * (dw / 2 + 0.2), y, cd / 2 - T / 2, 0, false);
    } else wall("z+", cw, 0, cd / 2 - T / 2, 0);
    // red pillars on the slab edge, carrying the beam band
    const hx = cw / 2 + ver, hz = cd / 2 + ver;
    for (const [len, along, fixed] of [[2 * hx, "x", hz], [2 * hx, "x", -hz], [2 * hz, "z", hx], [2 * hz, "z", -hx]] as const) {
      const n = Math.max(1, Math.round(len / BAY));
      for (let i = 0; i <= n; i++) {
        const q = -len / 2 + (i * len) / n;
        put(c, new THREE.CylinderGeometry(0.28, 0.32, H, 8), c.m.pillar, M(along === "x" ? q : fixed, y + H / 2, along === "x" ? fixed : q), false);
        if (f === 0) solidBox(c, 0.6, H, 0.6, along === "x" ? q : fixed, y, along === "x" ? fixed : q);
      }
    }
    // upper floors: railing round the balcony
    if (f > 0) {
      // rect() goes (-x,+z) -> (+x,+z) -> (+x,-z) -> (-x,-z): sides z+, x+, z-, x-
      const order: Side[] = ["z+", "x+", "z-", "x-"], gaps: Record<number, [number, number][]> = {};
      for (const o2 of o.openings ?? []) if (o2.floor === f) {
        const i = order.indexOf(o2.side), len = i % 2 ? 2 * hz : 2 * hx;
        (gaps[i] ??= []).push([len / 2, o2.w]);
      }
      fence(c, rect(hx, hz, y), 1.0, c.m.rail, true, gaps);
    }
    // the next floor's size and height, so the stair up to it can be laid out now
    const last = f === o.floors - 1;
    const nw = cw * shrink, nd = cd * shrink;
    const W = hx + 2.4, D = hz + 2.4;
    const iw = nw / 2 + ver + 0.3, id = nd / 2 + ver + 0.3;
    const rise = Math.max(1.6, (W - iw) * 0.6);
    const next = y + H + 0.8 + rise - 0.4 + 0.6; // the next slab's top
    hole = !last && inside ? (o.spiral ? spiralStair(c, nw, nd, y, next) : straightStair(c, nw, nd, y, next, f % 2 ? 1 : -1)) : null;
    // beam band: a solid ring over the pillars and the wall tops (the ceiling), open over the stairwell
    holedSlab(c, 2 * hx + 0.7, 0.8, 2 * hz + 0.7, y + H, last ? hole : [hole, o.shaft ?? null], c.m.wood, false);
    c.col.roofs.push(aabb(c, 2 * hx + 0.7, 0.8, 2 * hz + 0.7, 0, y + H, 0));
    box(c, 2 * hx + 0.9, 0.22, 2 * hz + 0.9, c.m.bracket, 0, y + H + 0.1, 0, 0, false);
    y += H + 0.8;
    if (!last) {
      roof(c, W, D, iw - 0.2, id - 0.2, y - 0.1, rise, 1.4);
      y += rise - 0.4; // the next slab sits right on the roof's inner edge
      cw = nw;
      cd = nd;
    } else {
      const r = Math.max(0, (cw - cd) / 2) * 0.9;
      const h = Math.min(cw, cd) * (o.topRatio ?? 0.55) + 1.5;
      roof(c, W, D, r, 0, y - 0.1, h, 1.8);
      const top = y - 0.1 + h;
      // ridge with tall iron horns (chiwen) at both ends
      box(c, 2 * r + 1, 0.7, 0.7, c.m.ridge, 0, top - 0.3, 0);
      for (const sx of [-1, 1]) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, sx * 0.35));
        put(c, new THREE.ConeGeometry(0.45, 3.4, 5), c.m.iron, new THREE.Matrix4().compose(new THREE.Vector3(sx * (r + 0.4), top + 1.4, 0), q, new THREE.Vector3(1, 1, 1)));
      }
      if (o.spire) {
        put(c, new THREE.CylinderGeometry(0.12, 0.35, o.spire, 6), c.m.iron, M(0, top + o.spire / 2, 0));
        for (let k = 1; k <= 3; k++) put(c, new THREE.TorusGeometry(0.6 - k * 0.1, 0.1, 4, 10), c.m.trim, M(0, top + (o.spire * k) / 4, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), false);
      }
      y = top;
    }
  }
  return { floors, sizes, top: y };
}


type Rect = { x0: number; x1: number; z0: number; z1: number };
type Hole = Rect | null;

// a slab w x d (bottom at y, h thick) with rectangular holes cut out of it (stairwells, the lift shaft)
function holedSlab(c: ACtx, w: number, h: number, d: number, y: number, holes: Hole | Hole[], mat: THREE.Material, walk: boolean) {
  const hs = (Array.isArray(holes) ? holes : [holes]).filter((q): q is Rect => !!q);
  const xs = [...new Set([-w / 2, w / 2, ...hs.flatMap((q) => [q.x0, q.x1])])].filter((v) => v >= -w / 2 && v <= w / 2).sort((p, q) => p - q);
  const zs = [...new Set([-d / 2, d / 2, ...hs.flatMap((q) => [q.z0, q.z1])])].filter((v) => v >= -d / 2 && v <= d / 2).sort((p, q) => p - q);
  // a grid of cells between the cut lines; keep the ones outside every hole, joined into strips along x
  for (let j = 0; j < zs.length - 1; j++) {
    const z0 = zs[j], z1 = zs[j + 1];
    if (z1 - z0 < 0.05) continue;
    let start: number | null = null;
    for (let i = 0; i <= xs.length - 1; i++) {
      const cx = i < xs.length - 1 ? (xs[i] + xs[i + 1]) / 2 : NaN, cz = (z0 + z1) / 2;
      const solid = i < xs.length - 1 && !hs.some((q) => cx > q.x0 && cx < q.x1 && cz > q.z0 && cz < q.z1);
      if (solid && start === null) start = xs[i];
      if (!solid && start !== null) {
        const x0 = start, x1 = xs[i];
        if (x1 - x0 > 0.05) {
          box(c, x1 - x0, h, z1 - z0, mat, (x0 + x1) / 2, y, (z0 + z1) / 2);
          if (walk) walkBox(c, x1 - x0, h, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2);
        }
        start = null;
      }
    }
  }
}

// a wall with an open doorway in the middle (no door leaf), red posts and a lintel
function doorway(c: ACtx, len: number, H: number, x: number, y: number, z: number, ry: number, dw: number, dh: number) {
  const s = sub(c, M(x, 0, z, ry)) as ACtx, side = (len - dw) / 2;
  wallPanel(s, side, H, -len / 2 + side / 2, y, 0);
  wallPanel(s, side, H, len / 2 - side / 2, y, 0);
  box(s, dw, H - dh, 0.4, s.m.wallPlain, 0, y + dh, 0);
  solidBox(s, dw, H - dh, 0.4, 0, y + dh, 0);
  box(s, dw + 0.8, 0.5, 0.7, s.m.pillar, 0, y + dh, 0);
  for (const sx of [-1, 1]) box(s, 0.45, dh, 0.7, s.m.pillar, sx * (dw / 2 + 0.2), y, 0, 0, false);
}

// a straight flight along the back wall of the room above (nw x nd), from y0 up to y1.
// dir: which way it climbs along x (floors alternate, so each flight starts where the last one ended).
// Returns the stairwell to cut out of the floor above.
function straightStair(c: ACtx, nw: number, nd: number, y0: number, y1: number, dir: number): Hole {
  const SW = 1.6, rise = y1 - y0, L = Math.min(nw - 2, rise * 1.35), zc = -nd / 2 + 0.55 + SW / 2;
  const bottom = -dir * (L / 2), n = Math.max(4, Math.round(rise / 0.28));
  for (let k = 0; k < n; k++)
    box(c, L / n, ((k + 1) * rise) / n, SW, k % 2 ? c.m.marbleShade : c.m.marble, bottom + dir * (k + 0.5) * (L / n), y0, zc, 0, k === 0 || k === n - 1);
  // a handrail along the open side; it's solid past the first steps so you can't walk in under the flight
  const ra = new THREE.Vector3(bottom, y0 + 1, zc + SW / 2 + 0.1), rb = new THREE.Vector3(-bottom, y1 + 1, zc + SW / 2 + 0.1);
  beam(c, ra, rb, 0.14, 0.14, c.m.rail);
  for (let k = 1; k <= 3; k++) {
    const p = ra.clone().lerp(rb, k / 4);
    box(c, 0.1, 1, 0.1, c.m.rail, p.x, p.y - 1, p.z, 0, false);
  }
  solidBox(c, L - 1.2, rise, 0.25, dir * 0.6, y0, zc + SW / 2 + 0.1);
  const a = new THREE.Vector3(bottom - dir * 0.3, y0, zc).applyMatrix4(c.T), b = new THREE.Vector3(-bottom + dir * 0.6, y1, zc).applyMatrix4(c.T);
  c.col.ramps.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, w: SW, ya: a.y, yb: b.y });
  // only the upper part needs head room through the floor above
  const t0 = Math.max(0, 1 - 2.6 / rise), xa = bottom + dir * t0 * L, xb = -bottom + dir * 0.05;
  return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: zc - SW / 2 - 0.15, z1: zc + SW / 2 + 0.15 };
}

// a spiral stair round a post in the middle of a small tower: one full turn per floor, starting and
// ending at the front, so you step off it straight out of the doorway. Returns the stairwell.
function spiralStair(c: ACtx, nw: number, nd: number, y0: number, y1: number): Hole {
  const r = Math.min(nw, nd) / 2 - 0.8, rm = r * 0.58, N = 20, rise = y1 - y0;
  put(c, new THREE.CylinderGeometry(0.3, 0.3, rise + 0.6, 8), c.m.pillar, M(0, y0 + rise / 2, 0), false);
  solidBox(c, 0.5, rise, 0.5, 0, y0, 0);
  const at = (k: number, rad: number) => new THREE.Vector3(Math.sin((2 * Math.PI * k) / N) * rad, y0 + (rise * k) / N, Math.cos((2 * Math.PI * k) / N) * rad);
  for (let k = 0; k < N; k++) {
    const p = at(k, rm), q = at(k + 1, rm);
    // a proper pie-slice step (a slice of a cylinder), chunky enough that the flight looks solid from below
    const top = y0 + (rise * (k + 1)) / N, thick = 0.5;
    put(c, new THREE.CylinderGeometry(r + 0.05, r + 0.05, thick, 4, 1, false, (2 * Math.PI * k) / N, ((2 * Math.PI) / N) * 1.04), k % 2 ? c.m.marbleShade : c.m.marble, M(0, top - thick / 2, 0), k % 4 === 0);
    // each piece reaches a quarter past both ends, so there are no slivers between pieces to fall through
    const a = p.clone().lerp(q, -0.25).applyMatrix4(c.T), b = p.clone().lerp(q, 1.25).applyMatrix4(c.T);
    c.col.ramps.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, w: r * 0.95, ya: a.y, yb: b.y });
  }
  // off the top, onto the floor in front of the stairwell
  const a = new THREE.Vector3(0, y1, rm).applyMatrix4(c.T), b = new THREE.Vector3(0, y1, r + 0.9).applyMatrix4(c.T);
  c.col.ramps.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, w: 1.4, ya: a.y, yb: b.y });
  return { x0: -r - 0.1, x1: r + 0.1, z0: -r - 0.1, z1: r + 0.1 };
}

// an inner lining on a wall (len long, standing at x, z, thickness T), facing the room's centre,
// with a gap for a doorway (dw wide, dh high) in the middle
function skin(c: ACtx, len: number, H: number, x: number, y: number, z: number, T: number, mat: THREE.Material, gap: [number, number] | null) {
  const ry = Math.atan2(-x, -z), nx = Math.sin(ry), nz = Math.cos(ry);
  const at = (u: number, w: number, y0: number, h: number) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (u + (uv.getX(i) - 0.5) * w) / BAY, (y0 - y + uv.getY(i) * h) / H);
    // u runs along the wall to the plane's right
    const px = x + nx * (T / 2 + 0.02) + Math.cos(ry) * u, pz = z + nz * (T / 2 + 0.02) - Math.sin(ry) * u;
    put(c, g, mat, M(px, y0 + h / 2, pz, ry), false);
  };
  if (!gap) return at(0, len - 0.1, y, H);
  const [dw, dh] = gap, side = (len - dw) / 2;
  at(-len / 2 + side / 2, side - 0.05, y, H);
  at(len / 2 - side / 2, side - 0.05, y, H);
  at(0, dw, y + dh, H - dh);
}

// dark lining with glowing lattice windows in a room's own colour
const _skins = new Map<number, THREE.Material>();
function roomSkin(a: number) {
  if (_skins.has(a)) return _skins.get(a)!;
  const col = new THREE.Color(a);
  const css = (k: number) => "#" + col.clone().multiplyScalar(k).getHexString();
  const tex = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = "#141218";
    x.fillRect(0, 0, w, h);
    x.fillStyle = css(0.35);
    x.fillRect(0, 0, 18, h);
    x.fillRect(w - 18, 0, 18, h);
    const px = 40, pw = w - 80, py = h * 0.18, ph = h * 0.5;
    const g = x.createLinearGradient(0, py, 0, py + ph);
    g.addColorStop(0, css(0.25));
    g.addColorStop(1, css(0.55));
    x.fillStyle = g;
    x.fillRect(px, py, pw, ph);
    x.strokeStyle = css(1);
    x.lineWidth = 3;
    for (let gx = px + 14; gx < px + pw; gx += 14) { x.beginPath(); x.moveTo(gx, py); x.lineTo(gx, py + ph); x.stroke(); }
    for (let gy = py + 14; gy < py + ph; gy += 14) { x.beginPath(); x.moveTo(px, gy); x.lineTo(px + pw, gy); x.stroke(); }
    x.fillStyle = css(0.9);
    x.fillRect(0, h * 0.82, w, 4); // a lit rail along the wall
  });
  tex.wrapS = THREE.RepeatWrapping;
  const m = toon(0x222222, tex, { emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.85 });
  _skins.set(a, m);
  return m;
}

function wallPanel(c: ACtx, len: number, h: number, x: number, y: number, z: number, ry = 0) {
  const g = new THREE.BoxGeometry(len, h, 0.4);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    if (face === 4 || face === 5) uv.setX(i, (uv.getX(i) * len) / BAY);
    else uv.setXY(i, 0.02, 0.5);
  }
  put(c, g, c.m.wall, M(x, y + h / 2, z, ry));
  solidBox(c, len, h, 0.4, x, y, z, ry);
}

// covered walkway on posts from a to b (floor heights may differ: it becomes a ramp)
function corridor(c: ACtx, a: THREE.Vector3, b: THREE.Vector3, width = 3.2, postH = 3.2, ground = false) {
  const dir = b.clone().sub(a), len = dir.length();
  // the deck is walkable (a ramp if the ends differ in height)
  {
    const pa = a.clone().setY(a.y + 0.2).applyMatrix4(c.T), pb = b.clone().setY(b.y + 0.2).applyMatrix4(c.T);
    c.col.ramps.push({ ax: pa.x, az: pa.z, bx: pb.x, bz: pb.z, w: width, ya: pa.y, yb: pb.y });
  }
  const n = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(width / 2);
  beam(c, a, b, width, 0.4, c.m.wood); // deck
  const k = Math.max(1, Math.round(len / BAY));
  for (let i = 0; i <= k; i++) {
    const p = a.clone().lerp(b, i / k);
    for (const s of [-1, 1]) put(c, new THREE.CylinderGeometry(0.2, 0.22, postH, 6), c.m.pillar, M(p.x + n.x * s, p.y + postH / 2, p.z + n.z * s), false);
  }
  for (const s of [-1, 1]) {
    const off = n.clone().multiplyScalar(s);
    fence(c, [a.clone().add(off), b.clone().add(off)], 0.9, c.m.rail, false, ground ? { 0: [[len / 2, 4]] } : {});
    beam(c, a.clone().add(off).setY(a.y + postH), b.clone().add(off).setY(b.y + postH), 0.35, 0.45, c.m.wood, false);
  }
  // pitched roof: two sloped planks meeting at a ridge
  const up = new THREE.Vector3(0, postH + 1.3, 0);
  {
    const wa = c.T.clone().multiply(M(a.x, a.y, a.z)), wb = c.T.clone().multiply(M(b.x, b.y, b.z));
    const pa = new THREE.Vector3().setFromMatrixPosition(wa), pb = new THREE.Vector3().setFromMatrixPosition(wb), r = width / 2 + 1.6;
    c.col.roofs.push({ x0: Math.min(pa.x, pb.x) - r, x1: Math.max(pa.x, pb.x) + r, z0: Math.min(pa.z, pb.z) - r, z1: Math.max(pa.z, pb.z) + r, y0: Math.min(pa.y, pb.y) + postH, y1: Math.max(pa.y, pb.y) + postH + 1.3 });
  }
  for (const s of [-1, 1]) {
    const eave = n.clone().multiplyScalar(s * 1.6).setY(postH - 0.1);
    const qa = a.clone().add(eave), qb = b.clone().add(eave), ra = a.clone().add(up), rb = b.clone().add(up);
    const g = new THREE.BufferGeometry().setFromPoints([qa, qb, rb, qa, rb, ra]);
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, len / 1.4, 0, len / 1.4, 1, 0, 0, len / 1.4, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 3, 4, 5]); // the roof material's other parts are indexed, so this must be too
    g.computeVertexNormals();
    put(c, g, c.m.roof, new THREE.Matrix4(), false);
  }
  beam(c, a.clone().add(up), b.clone().add(up), 0.4, 0.4, c.m.ridge, false);
}

// a heavy stone bridge from a to b: thick deck, solid parapets, buttresses underneath.
// Built to carry the Thunder Line one day; for now you walk across it.
function stoneBridge(c: ACtx, a: THREE.Vector3, b: THREE.Vector3, width: number) {
  const dir = b.clone().sub(a), len = dir.length(), u = dir.clone().normalize();
  const n = new THREE.Vector3(-u.z, 0, u.x);
  const down = new THREE.Vector3(0, -0.8, 0);
  beam(c, a.clone().add(down), b.clone().add(down), width, 1.6, c.m.stone);
  // a darker band and corbels under the deck
  beam(c, a.clone().add(new THREE.Vector3(0, -1.8, 0)), b.clone().add(new THREE.Vector3(0, -1.8, 0)), width - 1.2, 0.6, c.m.stoneDark, false);
  const k = Math.max(2, Math.round(len / 4));
  for (let i = 1; i < k; i++) {
    const p = a.clone().lerp(b, i / k);
    for (const s of [-1, 1]) box(c, 0.7, 1.4, 0.7, c.m.stoneDark, p.x + n.x * s * (width / 2 - 0.35), p.y - 3, p.z + n.z * s * (width / 2 - 0.35), 0, false);
  }
  // parapets: solid, with a red neon strip along the top
  const ry = -Math.atan2(u.z, u.x);
  for (const s of [-1, 1]) {
    const off = n.clone().multiplyScalar(s * (width / 2 - 0.3));
    beam(c, a.clone().add(off).setY(a.y + 0.55), b.clone().add(off).setY(b.y + 0.55), 0.6, 1.1, c.m.stoneDark);
    beam(c, a.clone().add(off).setY(a.y + 1.13), b.clone().add(off).setY(b.y + 1.13), 0.62, 0.06, c.m.rail, false);
    const pieces = Math.max(1, Math.ceil(len / 1.5));
    for (let i = 0; i < pieces; i++) {
      const p = a.clone().lerp(b, (i + 0.5) / pieces).add(off);
      solidBox(c, len / pieces, 1.2, 0.6, p.x, p.y, p.z, ry);
    }
  }
  // the deck is walkable
  const pa = a.clone().applyMatrix4(c.T), pb = b.clone().applyMatrix4(c.T);
  c.col.ramps.push({ ax: pa.x, az: pa.z, bx: pb.x, bz: pb.z, w: width - 1.2, ya: pa.y, yb: pb.y });
}

function brazier(c: ACtx, x: number, y: number, z: number, fires: THREE.Vector3[]) {
  put(c, new THREE.CylinderGeometry(0.5, 0.7, 2.4, 6), c.m.iron, M(x, y + 1.2, z), false);
  solidBox(c, 1.6, 3, 1.6, x, y, z);
  put(c, new THREE.CylinderGeometry(1.3, 0.6, 0.9, 8), c.m.iron, M(x, y + 2.8, z));
  for (let i = 0; i < 3; i++) put(c, new THREE.ConeGeometry(0.18, 0.9, 4), c.m.iron, M(x + Math.cos(i * 2.1) * 1.3, y + 3.5, z + Math.sin(i * 2.1) * 1.3), false);
  fires.push(new THREE.Vector3(x, y + 3.6, z));
}

// a tall pole carrying a vertical neon sign screen (glowing on both sides), in place of a cloth banner
function bannerPole(c: ACtx, x: number, y: number, z: number, h: number, ry = 0) {
  box(c, 0.35, h, 0.35, c.m.iron, x, y, z);
  put(c, new THREE.ConeGeometry(0.3, 1.2, 4), c.m.iron, M(x, y + h + 0.6, z), false);
  const s = sub(c, M(x, y, z, ry)) as ACtx;
  box(s, 3, 0.2, 0.2, s.m.iron, 1.4, h - 0.7, 0, 0, false);
  neonScreen(s, 2.4, 8.4, 1.4, h - 5.2, 0, 0, true);
}

// Vertical cyberpunk sign screens, like the stacked neon signs of a night market: a dark panel,
// a glowing frame and big stacked letters. Each new screen takes the next word and colour.
const SIGN_WORDS = ["ARASAKA", "STORM", "PUSH", "RESPECT", "THUNDER", "RANK UP", "STRONG", "NO REST", "DOJO", "RAMEN", "ELITE", "LEGEND"];
const SIGN_COLORS = ["#00e5ff", "#ff2fa0", "#3dff9a", "#ffd23a", "#ff3b3b", "#a66bff", "#ff8a2a", "#2fd0ff"];
let _sign = 0;
const _signMats = new Map<string, THREE.Material>();
function signMat(word: string, color: string) {
  const k = word + color;
  if (_signMats.has(k)) return _signMats.get(k)!;
  const tex = canvasTex(128, 512, (x, w, h) => {
    x.fillStyle = "#07060b";
    x.fillRect(0, 0, w, h);
    x.strokeStyle = color;
    x.lineWidth = 8;
    x.shadowColor = color;
    x.shadowBlur = 18;
    x.strokeRect(8, 8, w - 16, h - 16);
    const letters = [...word.replace(/ /g, "")];
    const step = Math.min(70, (h - 60) / letters.length);
    x.font = `bold ${Math.round(step * 0.9)}px Inter, Arial, sans-serif`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillStyle = "#fff";
    const top = h / 2 - (step * (letters.length - 1)) / 2;
    letters.forEach((ch, i) => { x.shadowBlur = 22; x.fillStyle = color; x.fillText(ch, w / 2, top + i * step); x.shadowBlur = 0; x.fillStyle = "rgba(255,255,255,0.85)"; x.fillText(ch, w / 2, top + i * step); });
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  _signMats.set(k, m);
  return m;
}
function neonScreen(c: ACtx, w: number, h: number, x: number, y: number, z: number, ry: number, twoSided: boolean) {
  const word = SIGN_WORDS[_sign % SIGN_WORDS.length], color = SIGN_COLORS[(_sign * 3) % SIGN_COLORS.length];
  _sign++;
  const s = sub(c, M(x, y, z, ry)) as ACtx;
  box(s, w + 0.2, h + 0.2, 0.25, s.m.iron, 0, -h / 2 - 0.1, 0, 0, false);
  const mat = signMat(word, color);
  put(s, new THREE.PlaneGeometry(w, h), mat, M(0, 0, 0.14), false);
  if (twoSided) put(s, new THREE.PlaneGeometry(w, h), mat, M(0, 0, -0.14, Math.PI), false);
}

// jagged basalt crags (vertex coloured, merged)
function crag(c: ACtx, x: number, z: number, h: number, r: number, rand: () => number, y0 = 0) {
  const g = new THREE.CylinderGeometry(r * (0.12 + rand() * 0.2), r, h, 7, 9);
  const p = g.attributes.position, col: number[] = [], cc = new THREE.Color();
  const ph = rand() * 6, lean = (rand() - 0.5) * h * 0.18;
  for (let k = 0; k < p.count; k++) {
    const vx = p.getX(k), vy = p.getY(k), vz = p.getZ(k), t = vy / h + 0.5, ang = Math.atan2(vz, vx);
    const s = 1 + 0.25 * Math.sin(vy * 0.15 + ph) + 0.18 * Math.sin(ang * 3 + ph) + 0.1 * Math.sin(ang * 7 + vy * 0.3);
    p.setXYZ(k, vx * s + lean * t * t, vy, vz * s);
    cc.set(t > 0.85 ? 0x55535c : t > 0.3 ? 0x3c3a42 : 0x2e2d33);
    col.push(cc.r, cc.g, cc.b);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  put(c, g, c.m.rock, M(x, y0 + h / 2, z, rand() * 3));
}

/* ---------- inside the Thunder Keep ---------- */

// the lift shaft, in the keep's own coordinates (it has to fit inside the smallest, top floor)
const SHAFT: Rect = { x0: 2.8, x1: 5.6, z0: 0.1, z1: 2.9 };
const LIFT_SPEED = 3, LIFT_WAIT = 4;

type KeepInfo = { floors: number[]; sizes: { w: number; d: number; h: number }[] };

// The Great Hall on the ground floor: red carpet from the door to the throne on its dais, a painted
// screen behind (the stair up hides behind it), two rows of red pillars, hanging lanterns, braziers.
function greatHall(kc: ACtx, keep: KeepInfo, fires: THREE.Vector3[], extras: THREE.Object3D[]) {
  const m = kc.m, y0 = keep.floors[0], H = keep.sizes[0].h, D = keep.sizes[0].d, W = keep.sizes[0].w;
  const carpet = toon(0x7a1410), gold = toon(0xb08a3e), lantern = toon(0xc8372d, undefined, { emissive: 0xff5a2a, emissiveIntensity: 0.9 });
  // carpet with a gold edge
  box(kc, 3.4, 0.03, D / 2 + 4, gold, 0, y0, (D / 2 - 4) / 2 + 0.1, 0, false);
  box(kc, 3, 0.05, D / 2 + 4, carpet, 0, y0, (D / 2 - 4) / 2 + 0.1, 0, false);
  // pillars
  for (const x of [-12, -6, 6, 12]) for (const z of [-6, 6]) {
    put(kc, new THREE.CylinderGeometry(0.42, 0.48, H, 10), m.pillar, M(x, y0 + H / 2, z), false);
    put(kc, new THREE.CylinderGeometry(0.62, 0.66, 0.4, 10), gold, M(x, y0 + 0.2, z), false);
    put(kc, new THREE.CylinderGeometry(0.62, 0.5, 0.5, 10), gold, M(x, y0 + H - 0.25, z), false);
    solidBox(kc, 1, H, 1, x, y0, z);
  }
  // the dais: two steps
  box(kc, 9, 0.35, 4.6, m.stoneDark, 0, y0, -5.6);
  walkBox(kc, 9, 0.35, 4.6, 0, y0, -5.6);
  box(kc, 6.4, 0.35, 3.4, m.marble, 0, y0 + 0.35, -6.1);
  walkBox(kc, 6.4, 0.35, 3.4, 0, y0 + 0.35, -6.1);
  box(kc, 3.6, 0.04, 2.2, carpet, 0, y0 + 0.7, -5.9, 0, false);
  // the throne: black lacquer, gold trim, a red cushion, a tall fan-shaped back
  const ty = y0 + 0.7, tz = -6.6;
  box(kc, 2.4, 0.6, 1.6, m.wood, 0, ty, tz);
  box(kc, 1.9, 0.18, 1.3, carpet, 0, ty + 0.6, tz + 0.05, 0, false);
  box(kc, 2.6, 3.4, 0.35, m.wood, 0, ty, tz - 0.75);
  box(kc, 2.9, 0.5, 0.45, gold, 0, ty + 3.4, tz - 0.75);
  for (const sx of [-1, 1]) {
    box(kc, 0.3, 1.1, 1.6, m.wood, sx * 1.25, ty, tz);
    box(kc, 0.36, 0.12, 1.7, gold, sx * 1.25, ty + 1.1, tz, 0, false);
    put(kc, new THREE.ConeGeometry(0.22, 1.2, 5), gold, M(sx * 1.45, ty + 4.3, tz - 0.75), false);
  }
  solidBox(kc, 2.8, 4, 2, 0, ty, tz - 0.2);
  // the painted screen behind the throne, with the storm emblem
  box(kc, 10, 5.2, 0.25, m.wallPlain, 0, y0, -8.15);
  box(kc, 10.4, 0.35, 0.4, gold, 0, y0 + 5.2, -8.15, 0, false);
  for (const sx of [-1, 1]) box(kc, 0.35, 5.2, 0.4, m.pillar, sx * 5.1, y0, -8.15, 0, false);
  solidBox(kc, 10, 5.2, 0.3, 0, y0, -8.15);
  extras.push(emblem(kc, 3.4, 0, y0 + 3.3, -7.98));
  // braziers either side of the dais
  for (const sx of [-1, 1]) brazier(kc, sx * 5.8, y0, -4.6, fires);
  // two big paper lanterns hanging over the carpet
  for (const z of [1, 7.5]) {
    put(kc, new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), m.iron, M(0, y0 + H - 0.7, z), false);
    put(kc, new THREE.SphereGeometry(0.75, 12, 8), lantern, M(0, y0 + H - 1.7, z, 0, 1, 1.2, 1));
    for (const dy of [-0.85, 0.85]) put(kc, new THREE.CylinderGeometry(0.42, 0.42, 0.14, 10), m.wood, M(0, y0 + H - 1.7 + dy, z), false);
  }
  // war banners down the side walls
  for (const sx of [-1, 1]) for (const z of [-4, 4]) neonScreen(kc, 1.6, 4.2, sx * (W / 2 - 0.62), y0 + H - 3, z, -sx * Math.PI / 2, false);
  // one warm light for the hall
  const l = new THREE.PointLight(0xff8a4a, 3, 30, 1.2);
  l.position.copy(new THREE.Vector3(0, y0 + H - 1.2, 0).applyMatrix4(kc.T));
  return [l];
}


// canvas helpers for the room props
function mapTex() {
  return canvasTex(512, 320, (g, w, h) => {
    g.fillStyle = "#2a1408"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,170,90,0.25)"; g.lineWidth = 1;
    for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = "#5a2c12"; g.beginPath(); g.ellipse(w / 2, h / 2, 210, 130, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#ffb060"; g.lineWidth = 3; g.setLineDash([8, 6]);
    g.beginPath(); g.moveTo(w / 2, 70); g.lineTo(w / 2, h / 2); g.lineTo(120, 220); g.moveTo(w / 2, h / 2); g.lineTo(392, 220); g.stroke();
    g.setLineDash([]);
    for (const [x, y, c, t] of [[w / 2, 70, "#ff4d3d", "ARASAKA"], [120, 220, "#ffb347", "SORARAN GATE"], [392, 220, "#9f8cff", "SLEEPBUILDERS"], [w / 2, h / 2, "#e8d8b0", "CROSSROADS"]] as const) {
      g.fillStyle = c; g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fill();
      g.font = "bold 18px system-ui, sans-serif"; g.textAlign = "center"; g.fillStyle = "#ffe6c0"; g.fillText(t, x, y + 32);
    }
  });
}
function boardTex(title: string, lines: string[]) {
  return canvasTex(256, 320, (g, w, h) => {
    g.fillStyle = "#1a0d0b"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#b08a3e"; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = "#e0483b"; g.font = "bold 24px system-ui, sans-serif"; g.textAlign = "center"; g.fillText(title, w / 2, 48);
    g.fillStyle = "#f3e9d2"; g.font = "18px system-ui, sans-serif";
    lines.forEach((t, i) => g.fillText(t, w / 2, 96 + i * 40));
  });
}
function tatamiTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#6f6a3e"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(30,26,10,0.25)"; g.lineWidth = 1;
    for (let y = 0; y < h; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = "#1b1a12"; g.lineWidth = 8; g.strokeRect(0, 0, w, h);
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
  });
}

// The upper floors of the Keep. The back strip of every room holds the stairs, and the lift stands
// right of centre, so the props sit in the front half and along the side walls.
function keepFloors(kc: ACtx, keep: KeepInfo) {
  const m = kc.m, gold = toon(0xb08a3e), glowOrange = toon(0x000000, undefined, { emissive: 0xff8a3a, emissiveIntensity: 0.6 });
  const room = (f: number) => ({ y: keep.floors[f], H: keep.sizes[f].h, W: keep.sizes[f].w, D: keep.sizes[f].d });

  // F2 War Room: a long map table glowing from below, and a board of clan challenges
  {
    const { y, W } = room(1);
    const tex = mapTex();
    box(kc, 6.4, 0.9, 3.8, m.wood, -4, y, 2.2);
    box(kc, 6.6, 0.12, 4, gold, -4, y + 0.9, 2.2, 0, false);
    put(kc, new THREE.PlaneGeometry(6.2, 3.7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex }), M(-4, y + 1.03, 2.2), false);
    box(kc, 6, 0.08, 3.4, glowOrange, -4, y + 0.05, 2.2, 0, false);
    solidBox(kc, 6.4, 1, 3.8, -4, y, 2.2);
    for (const [dx, dz] of [[-2.2, -2.6], [0, -2.6], [2.2, -2.6], [-2.2, 4.4], [0, 4.4]]) box(kc, 0.7, 0.5, 0.7, m.pillar, -4 + dx, y, 2.2 + dz + (dz < 0 ? 1.4 : -1.4) * 0, 0, false);
    put(kc, new THREE.PlaneGeometry(2.6, 3.2), new THREE.MeshBasicMaterial({ map: boardTex("CLAN CHALLENGES", ["Soraran Gate", "Sat 8 pm", "sleepBuilders", "Sun 9 pm", "Be there or", "lose respect"]) }), M(-W / 2 + 0.47, y + 2.6, 2, Math.PI / 2), false);
  }

  // F3 Hall of Records + library: champion plaques flanking the bridge doorways, bookshelves along
  // the front wall, and trophy plinths
  {
    const { y, W, D } = room(2);
    const plaque = toon(0x3a2a18), brass = toon(0xc9a24f, undefined, { emissive: 0x6a4a10, emissiveIntensity: 0.4 });
    for (const sx of [-1, 1]) for (const z of [-4.5, -3, 3, 4.5]) {
      box(kc, 0.15, 1.1, 0.9, plaque, sx * (W / 2 - 0.52), y + 1.6, z, 0, false);
      box(kc, 0.17, 0.5, 0.6, brass, sx * (W / 2 - 0.55), y + 1.95, z, 0, false);
    }
    // the library: tall shelves either side of the front doorway
    const books = [toon(0x6e1a14), toon(0x2a3b4a), toon(0x4a3a1a), toon(0x2e4a2a)];
    for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) {
      const x = sx * (2.6 + k * 2.4), z = D / 2 - 0.65;
      box(kc, 2.2, 3.6, 0.8, m.wood, x, y, z);
      solidBox(kc, 2.2, 3.6, 0.9, x, y, z);
      for (let shelf = 0; shelf < 4; shelf++) for (let b = 0; b < 7; b++)
        box(kc, 0.22, 0.55 + ((b * 7 + shelf * 3) % 4) * 0.06, 0.5, books[(b + shelf + k) % 4], x - 0.95 + b * 0.3, y + 0.25 + shelf * 0.85, z - 0.12, 0, false);
    }
    // trophy plinths
    for (const x of [-5, -2]) {
      box(kc, 0.9, 1.1, 0.9, m.stoneDark, x, y, -2.5);
      solidBox(kc, 0.9, 1.1, 0.9, x, y, -2.5);
      put(kc, new THREE.CylinderGeometry(0.28, 0.12, 0.5, 8), brass, M(x, y + 1.35, -2.5), false);
      put(kc, new THREE.CylinderGeometry(0.06, 0.18, 0.2, 8), brass, M(x, y + 1.0 + 0.1, -2.5), false);
    }
  }

  // F4 Dojo: a tatami floor, a mirror wall, wooden dummies and a lacquered bell
  {
    const { y, W, D, H } = room(3);
    const tat = tatamiTex();
    tat.wrapS = tat.wrapT = THREE.RepeatWrapping;
    tat.repeat.set(W / 2, D / 2);
    put(kc, new THREE.PlaneGeometry(W - 0.8, D - 0.8).rotateX(-Math.PI / 2), toon(0, tat), M(0, y + 0.02, 0), false);
    put(kc, new THREE.PlaneGeometry(D - 4, H - 1.2), new THREE.MeshBasicMaterial({ color: 0x8b9aa8, transparent: true, opacity: 0.35 }), M(-W / 2 + 0.47, y + (H - 1.2) / 2 + 0.3, 0, Math.PI / 2), false);
    for (const [x, z] of [[-4, 3], [-1, 3]]) {
      put(kc, new THREE.CylinderGeometry(0.3, 0.35, 2.2, 8), m.wood, M(x, y + 1.1, z));
      put(kc, new THREE.BoxGeometry(1.4, 0.15, 0.15), m.wood, M(x, y + 1.6, z), false);
      solidBox(kc, 0.7, 2.2, 0.7, x, y, z);
    }
    put(kc, new THREE.CylinderGeometry(0.55, 0.75, 1.2, 10, 1, true), toon(0x5c1713, undefined, { side: THREE.DoubleSide }), M(-W / 2 + 1.6, y + H - 1.6, -1.5), false);
    // a grid of small lanterns on the ceiling
    const lamp = toon(0xf3e2b8, undefined, { emissive: 0xffd8a0, emissiveIntensity: 0.7 });
    for (let i = -1; i <= 1; i++) for (const z of [-1, 3]) box(kc, 0.7, 0.35, 0.7, lamp, i * 4, y + H - 0.45, z, 0, false);
  }

  // F5 Storm Shrine: a stone altar with a crackling blue crystal, kneeling cushions, relic chimes
  {
    const { y, H } = room(4);
    const crystal = toon(0x9fd4ff, undefined, { emissive: 0x4a9fff, emissiveIntensity: 1.1 });
    box(kc, 2.6, 1, 1.8, m.stoneDark, -2.5, y, 2.4);
    box(kc, 2.9, 0.15, 2.1, gold, -2.5, y + 1, 2.4, 0, false);
    solidBox(kc, 2.6, 1.2, 1.8, -2.5, y, 2.4);
    put(kc, new THREE.OctahedronGeometry(0.55, 0), crystal, M(-2.5, y + 1.85, 2.4, 0, 1, 1.6, 1), false);
    for (let i = 0; i < 4; i++) box(kc, 0.8, 0.15, 0.8, m.pillar, -4 + i * 1.1, y, 4.4, 0, false);
    for (let i = 0; i < 5; i++) put(kc, new THREE.CylinderGeometry(0.05, 0.05, 0.6 + i * 0.15, 6), gold, M(-4.5 + i * 0.4, y + H - 0.9 - i * 0.07, -1), false);
  }

  // F6 Summit: a colossal sword driven into a block of stone (the Storm Colossus's, one day)
  {
    const { y } = room(5);
    box(kc, 2.4, 0.9, 2.4, m.stoneDark, -2.4, y, 1.6);
    solidBox(kc, 2.4, 0.9, 2.4, -2.4, y, 1.6);
    const steel = toon(0x8a9098, undefined, { emissive: 0x2a3a5a, emissiveIntensity: 0.3 });
    box(kc, 0.5, 3.4, 0.12, steel, -2.4, y + 0.6, 1.6, 0.4, false);
    box(kc, 1.5, 0.25, 0.3, gold, -2.4, y + 4, 1.6, 0.4, false);
    box(kc, 0.18, 1.2, 0.18, m.wood, -2.4, y + 4.2, 1.6, 0.4, false);
  }
}

// Each floor of the Keep has its own colours: neon coves along the ceiling, glowing corner strips,
// and two lights (Explore moves a single pair of lights into whichever room you stand in, so the
// light count never changes and phones don't recompile shaders).
export type Room = { name: string; box: Box; a: number; b: number; pa: THREE.Vector3; pb: THREE.Vector3 };
const ROOM_COLORS: [string, number, number][] = [
  ["Great Hall", 0xff3b5c, 0xffb347], // crimson + gold
  ["War Room", 0x00e5ff, 0x3d7bff], // cyan + blue
  ["Hall of Records", 0xffc94a, 0x3dff9a], // amber + jade
  ["Dojo", 0xff7ad9, 0xfff1d6], // sakura pink + paper white
  ["Storm Shrine", 0x6a5cff, 0x2fd0ff], // violet + electric blue
  ["Summit", 0xc04bff, 0xff2fa0], // purple + magenta
];
function roomGlow(kc: ACtx, keep: KeepInfo): Room[] {
  return keep.floors.map((y, f) => {
    const { w: W, d: D, h: H } = keep.sizes[f];
    const [name, a, b] = ROOM_COLORS[f % ROOM_COLORS.length];
    const ma = new THREE.MeshBasicMaterial({ color: a }), mb = new THREE.MeshBasicMaterial({ color: b });
    const top = y + H - 0.32;
    // ceiling coves on all four walls, colour a, with a thinner second line under them in colour b
    for (const sx of [-1, 1]) {
      box(kc, 0.08, 0.1, D - 0.8, ma, sx * (W / 2 - 0.5), top, 0, 0, false);
      box(kc, 0.08, 0.04, D - 0.8, mb, sx * (W / 2 - 0.5), top - 0.3, 0, 0, false);
    }
    for (const sz of [-1, 1]) {
      box(kc, W - 0.8, 0.1, 0.08, ma, 0, top, sz * (D / 2 - 0.5), 0, false);
      box(kc, W - 0.8, 0.04, 0.08, mb, 0, top - 0.3, sz * (D / 2 - 0.5), 0, false);
    }
    // glowing strips up the four corners
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(kc, 0.1, H - 0.6, 0.1, sx * sz > 0 ? ma : mb, sx * (W / 2 - 0.5), y + 0.1, sz * (D / 2 - 0.5), 0, false);
    const at = (x: number, yy: number, z: number) => new THREE.Vector3(x, yy, z).applyMatrix4(kc.T);
    return { name, box: aabb(kc, W, H, D, 0, y, 0), a, b, pa: at(-W / 4, y + H - 1, -D / 6), pb: at(W / 4, y + H - 1.2, D / 4) };
  });
}

// The Thunder Lift: an iron cage up through every floor, a platform that rides it on a fixed timetable
// (so every player sees it in the same place), and gates that only open on the floor where it stands.
function thunderLift(kc: ACtx, keep: KeepInfo, col: Collision) {
  const m = kc.m, S = SHAFT, cx = (S.x0 + S.x1) / 2, cz = (S.z0 + S.z1) / 2, sw = S.x1 - S.x0, sd = S.z1 - S.z0;
  const bottom = keep.floors[0], last = keep.floors.length - 1, top = keep.floors[last] + keep.sizes[last].h;
  const iron = toon(0x1d2028, undefined, { emissive: 0x2a4cbf, emissiveIntensity: 0.08 });
  const h = top - bottom;
  // corner posts, bars on three sides, a band at every floor
  for (const [x, z] of [[S.x0, S.z0], [S.x1, S.z0], [S.x0, S.z1], [S.x1, S.z1]]) put(kc, new THREE.CylinderGeometry(0.12, 0.12, h, 6), iron, M(x, bottom + h / 2, z), false);
  const bars = (ax: number, az: number, bx: number, bz: number) => {
    const n = Math.round(Math.hypot(bx - ax, bz - az) / 0.45);
    for (let i = 1; i < n; i++) put(kc, new THREE.CylinderGeometry(0.035, 0.035, h, 4), iron, M(ax + ((bx - ax) * i) / n, bottom + h / 2, az + ((bz - az) * i) / n), false);
  };
  bars(S.x0, S.z0, S.x1, S.z0);
  bars(S.x0, S.z0, S.x0, S.z1);
  bars(S.x1, S.z0, S.x1, S.z1);
  for (const y of keep.floors) {
    box(kc, sw + 0.2, 0.15, 0.15, iron, cx, y + 2.6, S.z1, 0, false);
    box(kc, sw + 0.2, 0.15, 0.15, iron, cx, y + 2.6, S.z0, 0, false);
  }
  // the cage walls are solid (the front is the gate)
  solidBox(kc, sw, h, 0.2, cx, bottom, S.z0);
  solidBox(kc, 0.2, h, sd, S.x0, bottom, cz);
  solidBox(kc, 0.2, h, sd, S.x1, bottom, cz);
  const world = aabb(kc, sw - 0.1, 0.1, sd - 0.1, cx, 0, cz);
  const lift: Lift = { x0: world.x0, x1: world.x1, z0: world.z0, z1: world.z1, stops: keep.floors.map((y) => new THREE.Vector3(0, y, 0).applyMatrix4(kc.T).y), gates: [], at: 0 };
  keep.floors.forEach((y, i) => lift.gates.push({ box: aabb(kc, sw, 2.6, 0.2, cx, y, S.z1), stop: lift.stops[i] }));
  col.lifts.push(lift);

  // the moving parts (not merged): platform with crackling lightning, and a sliding gate per floor
  const group = new THREE.Group();
  const plat = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(sw - 0.15, 0.25, sd - 0.15), m.iron);
  deck.position.y = -0.125;
  const glow = new THREE.LineSegments(new THREE.EdgesGeometry(deck.geometry), new THREE.LineBasicMaterial({ color: 0x8fc8ff }));
  glow.position.copy(deck.position);
  plat.add(deck, glow);
  const boltGeo = new THREE.BufferGeometry();
  const boltPos = new Float32Array(4 * 7 * 2 * 3);
  boltGeo.setAttribute("position", new THREE.BufferAttribute(boltPos, 3));
  const bolts = new THREE.LineSegments(boltGeo, new THREE.LineBasicMaterial({ color: 0xbfe3ff, transparent: true, blending: THREE.AdditiveBlending }));
  bolts.frustumCulled = false;
  plat.add(bolts);
  group.add(plat);
  const gates: THREE.Group[] = keep.floors.map((y) => {
    const g = new THREE.Group();
    for (let i = 0; i <= 6; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 4), iron);
      bar.position.set(S.x0 + 0.15 + (i * (sw - 0.3)) / 6, y + 1.25, S.z1);
      g.add(bar);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.1, 0.1), iron);
    rail.position.set(cx, y + 2.45, S.z1);
    g.add(rail);
    group.add(g);
    return g;
  });
  kc.T.decompose(group.position, group.quaternion, group.scale);

  // the timetable: up, stopping at every floor, then back down
  const order = [...keep.floors.keys(), ...[...keep.floors.keys()].reverse().slice(1, -1)];
  const legs: { t0: number; t1: number; y0: number; y1: number }[] = [];
  let t = 0;
  order.forEach((f, i) => {
    const y = keep.floors[f], nf = order[(i + 1) % order.length], ny = keep.floors[nf];
    legs.push({ t0: t, t1: t + LIFT_WAIT, y0: y, y1: y });
    t += LIFT_WAIT;
    const dur = Math.abs(ny - y) / LIFT_SPEED;
    legs.push({ t0: t, t1: t + dur, y0: y, y1: ny });
    t += dur;
  });
  const cycle = t;
  let flick = 0;
  const tick = (dt: number) => {
    const now = (Date.now() / 1000) % cycle;
    const leg = legs.find((l) => now >= l.t0 && now < l.t1) ?? legs[0];
    const k = (now - leg.t0) / (leg.t1 - leg.t0), e = k * k * (3 - 2 * k);
    const y = leg.y0 + (leg.y1 - leg.y0) * e;
    plat.position.set(cx, y, cz);
    lift.at = new THREE.Vector3(0, y, 0).applyMatrix4(kc.T).y;
    // a gate lifts while the platform is at its floor
    keep.floors.forEach((fy, i) => {
      const open = Math.abs(fy - y) < 0.25 ? 1 : 0;
      gates[i].position.y += (open * 2.3 - gates[i].position.y) * Math.min(1, dt * 6);
    });
    // lightning flickers round the platform's edges
    if ((flick -= dt) <= 0) {
      flick = 0.07 + Math.random() * 0.08;
      let j = 0;
      for (const [x, z] of [[-sw / 2, -sd / 2], [sw / 2, -sd / 2], [sw / 2, sd / 2], [-sw / 2, sd / 2]]) {
        let px = x * 0.9, py = 0.05, pz = z * 0.9;
        for (let s2 = 0; s2 < 7; s2++) {
          const nx = x * 0.9 + (Math.random() - 0.5) * 0.35, ny = py + 0.25 + Math.random() * 0.2, nz = z * 0.9 + (Math.random() - 0.5) * 0.35;
          boltPos.set([px, py, pz, nx, ny, nz], j);
          j += 6;
          px = nx; py = ny; pz = nz;
        }
      }
      boltGeo.attributes.position.needsUpdate = true;
      (bolts.material as THREE.LineBasicMaterial).opacity = 0.5 + Math.random() * 0.5;
    }
  };
  return { group, tick };
}

/* ---------- the citadel ---------- */

const HW = 76, FRONT = 80, BACK = -100;
// the land around the walls: flat inside, rolling hills outside
export function groundAt(x: number, z: number) {
  const d = Math.max(Math.abs(x) - HW, z - FRONT, BACK - z);
  // flat along Neon Bamboo Row (the street out of the front gate) and its bamboo groves
  const street = z > FRONT ? Math.min(1, Math.max(0, (Math.abs(x) - 40) / 20)) : 1;
  return d > 8 ? Math.sin(x * 0.03) * Math.cos(z * 0.025) * 10 * Math.min(1, (d - 8) / 60) * street : 0;
}
export const ARASAKA_SPAWN = new THREE.Vector3(0, 0, FRONT + 34);

export function buildArasaka(env: Env, { bare = false } = {}) {
  _sign = 0;
  const rand = rngFrom("arasaka-citadel");
  const root = new THREE.Group();
  const b = new Builder();
  const col: Collision = { walk: [], solid: [], ramps: [], doors: [], roofs: [], lifts: [] };
  const c: ACtx = { b, T: new THREE.Matrix4(), m: mats(env), col };
  const m = c.m;
  const fires: THREE.Vector3[] = [];

  const T2 = 9, T3 = 20; // terrace heights

  if (!bare) {
    // dark rocky ground with rolling hills outside the walls
    const ground = new THREE.PlaneGeometry(800, 800, 80, 80);
    ground.rotateX(-Math.PI / 2);
    const gp = ground.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), z = gp.getZ(i), d = Math.max(Math.abs(x) - HW, z - FRONT, BACK - z);
      if (d > 8) gp.setY(i, groundAt(x, z));
    }
    ground.computeVertexNormals();
    b.add(ground, m.grass, new THREE.Matrix4(), false);
  }

  // lower court paving
  const court = new THREE.BoxGeometry(2 * HW, 0.3, FRONT - 20);
  const cuv = court.attributes.uv;
  for (let i = 0; i < cuv.count; i++) cuv.setXY(i, (cuv.getX(i) * 2 * HW) / 8, (cuv.getY(i) * (FRONT - 20)) / 8);
  put(c, court, m.paving, M(0, 0.15, (FRONT + 20) / 2), false);
  walkBox(c, 2 * HW, 0.3, FRONT - 20, 0, 0, (FRONT + 20) / 2);

  // terrace 2 (barracks yard) and terrace 3 (keep platform): stone blocks with sloped faces
  stone(c, 2 * HW, T2, 20 - BACK, 0, 0, (20 + BACK) / 2, 0.8);
  stone(c, 100, T3 - T2, -32 - BACK, 0, T2, (-32 + BACK) / 2, 0.8);
  // grand stairs up each terrace, with braziers at the foot and top
  steps(c, 14, T2, 16, 0, 0, 20 + 16);
  steps(c, 10, T3 - T2, 13, 0, T2, -32 + 13);
  for (const sx of [-1, 1]) {
    brazier(c, sx * 10, 0.3, 39, fires);
    brazier(c, sx * 10, T2, 15, fires);
    brazier(c, sx * 8, T3, -36, fires);
  }
  // parapets along the terrace edges, broken at the stairs
  for (const [y, z, half, gap] of [[T2, 19.4, HW - 4, 8], [T3, -32.6, 49, 6]] as const)
    for (const sx of [-1, 1]) {
      box(c, half - gap, 1.1, 0.8, m.stoneDark, sx * (gap + half) / 2, y, z);
      solidBox(c, half - gap, 1.1, 0.8, sx * (gap + half) / 2, y, z);
    }

  // outer wall with corner towers; the front wall is split by the gatehouse
  rampart(c, -HW, BACK, HW, BACK, 12, -1);
  rampart(c, -HW, BACK, -HW, FRONT, 10, -1);
  rampart(c, HW, FRONT, HW, BACK, 10, -1);
  rampart(c, -HW, FRONT, -22, FRONT, 10, 1);
  rampart(c, 22, FRONT, HW, FRONT, 10, 1);
  for (const [x, z] of [[-HW, FRONT], [HW, FRONT], [-HW, BACK], [HW, BACK]]) {
    stone(c, 14, 14, 14, x, 0, z, 1.4);
    building(sub(c, M(x, 14, z, z > 0 ? 0 : Math.PI)) as ACtx, 6, 6, { floors: 2, wallH: 3.4, door: false });
  }

  // gatehouse: two battered towers, a deep gate passage, and a two-storey hall bridging them
  for (const sx of [-1, 1]) {
    stone(c, 14, 18, 16, sx * 17, 0, FRONT, 1.6);
    building(sub(c, M(sx * 17, 18, FRONT)) as ACtx, 6, 6, { floors: 3, wallH: 3.4, door: false, shrink: 0.85, topRatio: 0.8 });
  }
  stone(c, 22, 7, 16, 0, 11, FRONT); // lintel block over the passage
  // the great gate: studded doors that swing open as you walk up, and the clan emblem above
  door(c, 20, 10.7, 0, 0.3, FRONT + 6, m.pillar, true);
  const extras: THREE.Object3D[] = [emblem(c, 6, 0, 14.6, FRONT + 8.05)];
  building(sub(c, M(0, 18, FRONT)) as ACtx, 14, 8, { floors: 2, wallH: 4, door: false, shrink: 0.8 });
  for (const sx of [-1, 1]) bannerPole(c, sx * 26, 0.3, FRONT + 10, 16, sx > 0 ? 0 : Math.PI);

  // lower court: armory and forge on either side, banners down the processional way
  building(sub(c, M(-48, 0.3, 52, Math.PI / 2)) as ACtx, 22, 11, { floors: 2, wallH: 4.2 });
  building(sub(c, M(48, 0.3, 52, -Math.PI / 2)) as ACtx, 22, 11, { floors: 1, wallH: 5 });
  stone(c, 3.4, 16, 3.4, 54, 0.3, 46, 0.4); // forge chimney
  fires.push(new THREE.Vector3(54, 17, 46));
  for (let z = 46; z <= 70; z += 12) for (const sx of [-1, 1]) bannerPole(c, sx * 9, 0.3, z, 12, sx > 0 ? 0 : Math.PI);

  // barracks yard: two long barracks, a sand training square with dummies and weapon racks
  // (set out at x 59 so their podiums clear the keep terrace's front face at x 50)
  for (const sx of [-1, 1]) building(sub(c, M(sx * 59, T2, -18, -sx * Math.PI / 2)) as ACtx, 46, 12, { floors: 2, wallH: 4 });
  box(c, 40, 0.25, 26, m.sand, 0, T2, -4, 0, false);
  walkBox(c, 40, 0.25, 26, 0, T2, -4);
  // the fence round the sand yard: solid, with a gate in the middle of the north and south sides
  fence(c, rect(20, 13, T2 + 0.25).map((v) => v.setZ(v.z - 4)), 1, m.wood, true, { 0: [[20, 5]], 2: [[20, 5]] });
  for (let i = 0; i < 6; i++) {
    const x = -14 + (i % 3) * 14, z = i < 3 ? -11 : 3;
    put(c, new THREE.CylinderGeometry(0.5, 0.55, 3.4, 8), m.wood, M(x, T2 + 1.9, z));
    put(c, new THREE.BoxGeometry(2, 0.2, 0.2), m.wood, M(x, T2 + 2.8, z));
  }
  for (const sx of [-1, 1]) {
    box(c, 0.3, 3, 6, m.wood, sx * 21.5, T2, -4);
    for (let k = 0; k < 6; k++) put(c, new THREE.CylinderGeometry(0.06, 0.06, 3.8, 4), m.iron, M(sx * 21.2, T2 + 2.1, -6.5 + k), false);
  }
  // covered walkways from the barracks to the top of the grand stairs
  for (const sx of [-1, 1]) corridor(c, new THREE.Vector3(sx * 9, T2, 13), new THREE.Vector3(sx * 47.5, T2, 13), 3.2, 3.2, true);

  // the keep platform: Thunder Keep with two watchtowers and sky bridges
  const kz = -66;
  stone(c, 44, 5, 38, 0, T3, kz, 1);
  steps(c, 8, 5, 6, 0, T3, kz + 19 + 6);
  const KW = 30, KS = 0.85;
  const kc = sub(c, M(0, T3 + 5, kz)) as ACtx;
  const keep = building(kc, KW, 25, { floors: 6, wallH: 5.4, shrink: KS, veranda: 1.6, spire: 14, shaft: SHAFT, openings: [{ floor: 2, side: "x+", w: 6.2 }, { floor: 2, side: "x-", w: 6.2 }], skin: (f) => roomSkin(ROOM_COLORS[f][1]) });
  for (const sx of [-1, 1]) {
    const tx = sx * 38, tz = kz - 4;
    // the stone base reaches forward past the tower's own front steps, and a stair climbs to it from the terrace
    stone(c, 17, 5, 22, tx, T3, tz + 2.5, 0.8);
    steps(c, 6, 5, 7, tx, T3, tz + 2.5 + 11 + 7);
    const tower = building(sub(c, M(tx, T3 + 5, tz)) as ACtx, 10, 10, { floors: 5, wallH: 4.6, shrink: 0.92, spiral: true, openings: [{ floor: 2, side: sx > 0 ? "x-" : "x+", w: 6.2 }] });
    // bridge from the tower's 3rd floor to the keep's 3rd floor
    const fy = T3 + 5 + tower.floors[2], ky = T3 + 5 + keep.floors[2];
    const kw = (KW * KS * KS) / 2 + 1.6 + 0.3;
    // the bridge lands right on the tower's balcony slab (no gap)
    stoneBridge(c, new THREE.Vector3(tx - sx * (tower.sizes[2].w / 2 + 1.6), fy, tz), new THREE.Vector3(sx * kw, ky, tz), 6);
    // tall neon sign screens down the keep's face
    neonScreen(c, 3, 14, sx * 7.5, T3 + 5 + keep.floors[1] + 2, kz + 12.5 + 1.6 + 0.4, 0, false);
  }
  for (const sx of [-1, 1]) brazier(c, sx * 17, T3 + 5, kz + 16, fires);
  const keepLights = greatHall(kc, keep, fires, extras);
  keepFloors(kc, keep);
  const rooms = roomGlow(kc, keep);
  const lift = thunderLift(kc, keep, col);
  // the emblem high on the keep's top storey, facing the gate
  const topF = keep.sizes.length - 1, topS = keep.sizes[topF];
  extras.push(emblem(c, 5, 0, T3 + 5 + keep.floors[topF] + topS.h * 0.5, kz + topS.d / 2 + 0.25));

  // basalt crags rising behind the citadel and along its flanks
  for (let i = 0; i < 16; i++) {
    const t = i / 15, x = -150 + t * 300 + (rand() - 0.5) * 20;
    const z = BACK - 25 - rand() * 50 - Math.abs(x) * 0.15;
    crag(c, x, z, 50 + rand() * 70 * (1 - Math.abs(t - 0.5)), 16 + rand() * 12, rand, -4);
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) crag(c, sx * (HW + 22 + rand() * 25), BACK + 20 + i * 40, 28 + rand() * 30, 10 + rand() * 6, rand, -4);

  b.finish(root);
  for (const e of extras) root.add(e);
  for (const d of col.doors) root.add(d.pivot);
  root.add(lift.group, ...keepLights);

  // fire: glowing cores plus additive flames that flicker
  const glow = softTexture();
  const fireGroup = new THREE.Group();
  for (const f of fires) {
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 0), m.fire);
    core.position.copy(f);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff6a20, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.position.copy(f).setY(f.y + 0.8);
    sp.scale.setScalar(6);
    fireGroup.add(core, sp);
  }
  root.add(fireGroup);
  // a few warm lights so the dark stone catches the fire
  for (const p of [new THREE.Vector3(0, 6, 40), new THREE.Vector3(0, T2 + 6, 10), new THREE.Vector3(0, T3 + 12, kz + 20)]) {
    const l = new THREE.PointLight(0xff7a3a, 2.2, 60, 1.2);
    l.position.copy(p);
    root.add(l);
  }

  // dark pines outside the walls (and a few in the lower court)
  const spots: { p: THREE.Vector3; kind: TreeKind }[] = [];
  if (!bare)
    for (let i = 0; i < 80; i++) {
      const a = rand() * Math.PI * 2, r = 120 + rand() * 90;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.9;
      if (z < BACK - 10 || (z > FRONT && Math.abs(x) < 52)) continue; // not on the bamboo street
      spots.push({ p: new THREE.Vector3(x, 0, z), kind: rand() < 0.8 ? "pine" : "green" });
    }
  for (const [x, z] of [[-30, 66], [30, 66], [-62, 30], [62, 30], [-62, 70], [62, 70]]) spots.push({ p: new THREE.Vector3(x, 0.3, z), kind: "pine" });
  root.add(trees(rand, spots));
  if (!bare) root.add(mountains(rand, env.mountainTint));

  const q = new THREE.Quaternion();
  const tick = (t: number, dt = 0.016) => {
    lift.tick(dt);
    fireGroup.children.forEach((o, i) => {
      if (o instanceof THREE.Sprite) o.scale.setScalar(5.5 + Math.sin(t * 9 + i) * 0.8 + Math.sin(t * 23 + i * 3) * 0.5);
    });
    // doors ease toward open or shut
    for (const d of col.doors) {
      if (d.open === d.target) continue;
      d.open = d.target > d.open ? Math.min(d.target, d.open + dt * 1.6) : Math.max(d.target, d.open - dt * 1.2);
      const k = d.open * d.open * (3 - 2 * d.open);
      d.pivot.quaternion.copy(d.base).multiply(q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.sign * k * Math.PI * 0.5));
    }
  };
  return { root, tick, col, rooms };
}
