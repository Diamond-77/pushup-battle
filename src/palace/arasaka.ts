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
    wall: toon(0, wallTex, { emissive: 0xff5040, emissiveMap: wallTex, emissiveIntensity: 0.55 + env.lamp * 0.35 }),
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
export type Collision = { walk: Box[]; solid: Box[]; ramps: Ramp[]; doors: Door[]; roofs: Box[] };
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

// stairs plus their walking slope
function steps(c: ACtx, w: number, h: number, depth: number, x: number, y: number, z: number) {
  stairs(c, w, h, depth, x, y, z);
  // a solid landing slab from the top step back into the wall behind it: battered walls lean back,
  // so without it there's an open gap between the last step and the floor above
  box(c, w + 1, h, 1.6, c.m.marble, x, y, z - depth - 0.8, 0, false);
  walkBox(c, w, h, 1.6, x, y, z - depth - 0.8);
  // the walking ramp runs a little past the top step onto the landing, so there's never a gap to fall into
  const a = new THREE.Vector3(x, y, z + 0.3).applyMatrix4(c.T), b = new THREE.Vector3(x, y + h, z - depth - 0.9).applyMatrix4(c.T);
  c.col.ramps.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, w, ya: a.y, yb: b.y });
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

type BOpts = { floors: number; wallH?: number; shrink?: number; veranda?: number; door?: boolean; spire?: number; topRatio?: number; banners?: boolean };

// A multi-storey hall or tower. Returns the height of each floor's walking surface (slab top), and the top.
export function building(c: ACtx, w: number, d: number, o: BOpts) {
  const ver = o.veranda ?? 1.3, shrink = o.shrink ?? 0.84, floors: number[] = [], sizes: { w: number; d: number; h: number }[] = [];
  let y = 0, cw = w, cd = d;
  for (let f = 0; f < o.floors; f++) {
    const H = (o.wallH ?? 4.4) * (f === 0 ? 1.15 : 1);
    const sw = cw + 2 * ver + 0.6, sd = cd + 2 * ver + 0.6;
    // floor slab (the ground floor gets a stone podium with steps)
    if (f === 0) {
      stone(c, sw + 1.6, 1.4, sd + 1.6, 0, y, 0, 0.3);
      if (o.door !== false) steps(c, 4.6, 1.4, 2.2, 0, y, sd / 2 + 0.8 + 2.2);
      y += 1.4;
    } else {
      box(c, sw, 0.6, sd, c.m.wood, 0, y, 0);
      walkBox(c, sw, 0.6, sd, 0, y, 0);
      y += 0.6;
    }
    floors.push(y);
    sizes.push({ w: cw, d: cd, h: H });
    // wall shell: four thin walls, the front one with a doorway on the ground floor
    const T = 0.4;
    wallPanel(c, cw, H, 0, y, -cd / 2 + T / 2);
    wallPanel(c, cd, H, -cw / 2 + T / 2, y, 0, Math.PI / 2);
    wallPanel(c, cd, H, cw / 2 - T / 2, y, 0, Math.PI / 2);
    if (f === 0 && o.door !== false) {
      const dw = Math.min(3.2, cw * 0.3), dh = Math.min(3.6, H - 0.8), side = (cw - dw) / 2;
      wallPanel(c, side, H, -cw / 2 + side / 2, y, cd / 2 - T / 2);
      wallPanel(c, side, H, cw / 2 - side / 2, y, cd / 2 - T / 2);
      box(c, dw, H - dh, T, c.m.wallPlain, 0, y + dh, cd / 2 - T / 2);
      solidBox(c, dw, H - dh, T, 0, y + dh, cd / 2 - T / 2);
      door(c, dw, dh, 0, y, cd / 2 - T / 2, c.m.pillar);
      box(c, dw + 0.8, 0.5, T + 0.3, c.m.pillar, 0, y + dh, cd / 2 - T / 2); // red lintel
      for (const sx of [-1, 1]) box(c, 0.45, dh, T + 0.3, c.m.pillar, sx * (dw / 2 + 0.2), y, cd / 2 - T / 2, 0, false);
    } else wallPanel(c, cw, H, 0, y, cd / 2 - T / 2);
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
    if (f > 0) railing(c, rect(hx, hz, y), 1.0, c.m.rail, true);
    // beam band: a solid ring over the pillars and the wall tops (the ceiling)
    box(c, 2 * hx + 0.7, 0.8, 2 * hz + 0.7, c.m.wood, 0, y + H, 0);
    c.col.roofs.push(aabb(c, 2 * hx + 0.7, 0.8, 2 * hz + 0.7, 0, y + H, 0));
    box(c, 2 * hx + 0.9, 0.22, 2 * hz + 0.9, c.m.bracket, 0, y + H + 0.1, 0, 0, false);
    y += H + 0.8;
    const W = hx + 2.4, D = hz + 2.4;
    if (f < o.floors - 1) {
      const nw = cw * shrink, nd = cd * shrink;
      const iw = nw / 2 + ver + 0.3, id = nd / 2 + ver + 0.3;
      const rise = Math.max(1.6, (W - iw) * 0.6);
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
function corridor(c: ACtx, a: THREE.Vector3, b: THREE.Vector3, width = 3.2, postH = 3.2) {
  const dir = b.clone().sub(a), len = dir.length();
  const n = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(width / 2);
  beam(c, a, b, width, 0.4, c.m.wood); // deck
  const k = Math.max(1, Math.round(len / BAY));
  for (let i = 0; i <= k; i++) {
    const p = a.clone().lerp(b, i / k);
    for (const s of [-1, 1]) put(c, new THREE.CylinderGeometry(0.2, 0.22, postH, 6), c.m.pillar, M(p.x + n.x * s, p.y + postH / 2, p.z + n.z * s), false);
  }
  for (const s of [-1, 1]) {
    const off = n.clone().multiplyScalar(s);
    railing(c, [a.clone().add(off), b.clone().add(off)], 0.9, c.m.rail);
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

function brazier(c: ACtx, x: number, y: number, z: number, fires: THREE.Vector3[]) {
  put(c, new THREE.CylinderGeometry(0.5, 0.7, 2.4, 6), c.m.iron, M(x, y + 1.2, z), false);
  solidBox(c, 1.6, 3, 1.6, x, y, z);
  put(c, new THREE.CylinderGeometry(1.3, 0.6, 0.9, 8), c.m.iron, M(x, y + 2.8, z));
  for (let i = 0; i < 3; i++) put(c, new THREE.ConeGeometry(0.18, 0.9, 4), c.m.iron, M(x + Math.cos(i * 2.1) * 1.3, y + 3.5, z + Math.sin(i * 2.1) * 1.3), false);
  fires.push(new THREE.Vector3(x, y + 3.6, z));
}

function bannerPole(c: ACtx, x: number, y: number, z: number, h: number, ry = 0) {
  box(c, 0.35, h, 0.35, c.m.iron, x, y, z);
  put(c, new THREE.ConeGeometry(0.3, 1.2, 4), c.m.iron, M(x, y + h + 0.6, z), false);
  const s = sub(c, M(x, y, z, ry)) as ACtx;
  box(s, 3, 0.2, 0.2, s.m.iron, 1.4, h - 0.7, 0, 0, false);
  put(s, new THREE.PlaneGeometry(2.6, 9), s.m.banner, M(1.4, h - 5.3, 0), false);
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

/* ---------- the citadel ---------- */

const HW = 76, FRONT = 80, BACK = -100;
// the land around the walls: flat inside, rolling hills outside
export function groundAt(x: number, z: number) {
  const d = Math.max(Math.abs(x) - HW, z - FRONT, BACK - z);
  return d > 8 ? Math.sin(x * 0.03) * Math.cos(z * 0.025) * 10 * Math.min(1, (d - 8) / 60) : 0;
}
export const ARASAKA_SPAWN = new THREE.Vector3(0, 0, FRONT + 34);

export function buildArasaka(env: Env, { bare = false } = {}) {
  const rand = rngFrom("arasaka-citadel");
  const root = new THREE.Group();
  const b = new Builder();
  const col: Collision = { walk: [], solid: [], ramps: [], doors: [], roofs: [] };
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
  for (const sx of [-1, 1]) building(sub(c, M(sx * 52, T2, -18, -sx * Math.PI / 2)) as ACtx, 46, 12, { floors: 2, wallH: 4 });
  box(c, 40, 0.25, 26, m.sand, 0, T2, -4, 0, false);
  walkBox(c, 40, 0.25, 26, 0, T2, -4);
  railing(c, rect(20, 13, T2 + 0.25), 1, m.wood, true);
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
  for (const sx of [-1, 1]) corridor(c, new THREE.Vector3(sx * 9, T2, 13), new THREE.Vector3(sx * 40, T2, 13));

  // the keep platform: Thunder Keep with two watchtowers and sky bridges
  const kz = -66;
  stone(c, 44, 5, 38, 0, T3, kz, 1);
  steps(c, 8, 5, 6, 0, T3, kz + 19 + 6);
  const KW = 30, KS = 0.85;
  const keep = building(sub(c, M(0, T3 + 5, kz)) as ACtx, KW, 25, { floors: 6, wallH: 5.4, shrink: KS, veranda: 1.6, spire: 14 });
  for (const sx of [-1, 1]) {
    const tx = sx * 38, tz = kz - 4;
    stone(c, 14, 5, 14, tx, T3, tz, 0.8);
    const tower = building(sub(c, M(tx, T3 + 5, tz)) as ACtx, 8, 8, { floors: 5, wallH: 4.6, shrink: 0.9 });
    // bridge from the tower's 3rd floor to the keep's 3rd floor
    const fy = T3 + 5 + tower.floors[2], ky = T3 + 5 + keep.floors[2];
    const kw = (KW * KS * KS) / 2 + 1.6 + 0.3;
    corridor(c, new THREE.Vector3(tx - sx * 5.9, fy, tz), new THREE.Vector3(sx * kw, ky, tz), 3, 3);
    // long war banners down the keep's face
    put(c, new THREE.PlaneGeometry(3, 16), m.banner, M(sx * 7.5, T3 + 5 + keep.floors[1] + 2, kz + 12.5 + 1.6 + 0.35), false);
  }
  for (const sx of [-1, 1]) brazier(c, sx * 17, T3 + 5, kz + 16, fires);
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
      if (z < BACK - 10) continue;
      spots.push({ p: new THREE.Vector3(x, 0, z), kind: rand() < 0.8 ? "pine" : "green" });
    }
  for (const [x, z] of [[-30, 66], [30, 66], [-62, 30], [62, 30], [-62, 70], [62, 70]]) spots.push({ p: new THREE.Vector3(x, 0.3, z), kind: "pine" });
  root.add(trees(rand, spots));
  if (!bare) root.add(mountains(rand, env.mountainTint));

  const q = new THREE.Quaternion();
  const tick = (t: number, dt = 0.016) => {
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
  return { root, tick, col };
}
