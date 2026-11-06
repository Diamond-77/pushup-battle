import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Box, Lift, Ramp } from "../palace/arasaka";

// The Thunder Line: a sleek black metro of 7 enclosed cars circling the Arasaka empire on a raised
// viaduct. 12 m up at the front (over the gate road), climbing the sides, then 34 m up at the back where
// it runs straight through the east watchtower, the Thunder Keep's War Room and the west watchtower.
// Its place comes from the clock (Date.now), so every player sees the train in the same spot with no
// server. Stops alternate: one lap at Gate East and Back West, the next at Gate West, Back East and the
// Keep Halt. It waits 15 s with the doors wide open; walk in and it carries you.

const CAR_L = 7.6, CAR_W = 3, GAP = 0.5, PITCH = CAR_L + GAP, CARS = 7, TRAIN_L = CARS * PITCH - GAP;
const CRUISE = 15, PASS = 8, ACC = 1.3, DWELL = 15, DT = 0.1;
const DOOR_Z = 1.9, DOOR_W = 1.6, DOOR_H = 2.3; // two doors a side, each 1.9 m from the car's middle
const FRONT_Z = 88, SIDE_X = 92, BACK_Z = -70, R = 10;
const LOW = 12, HIGH = 34.29, KEEP_Y = 36.22, KEEP_HALF = 14.65, TOWER = [31.8, 44.2];

type Station = { name: string; s: number; side: -1 | 1 | 0; lift: boolean; laps: number[] }; // side: which side of the train the platform is on (-1 left, 0 both)
export type TrainCar = { pos: THREE.Vector3; yaw: number; pitch: number; open: number; i: number };

/* ----- the line: a rounded rectangle, run clockwise seen from above (front +x, east side -z, back -x, west side +z) ----- */
function buildPath() {
  const pts: THREE.Vector3[] = [];
  const line = (ax: number, az: number, bx: number, bz: number) => {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az));
    for (let k = 0; k < n; k++) pts.push(new THREE.Vector3(ax + ((bx - ax) * k) / n, 0, az + ((bz - az) * k) / n));
  };
  const arc = (cx: number, cz: number, a0: number) => {
    for (let k = 0; k < 16; k++) { const a = a0 - (k / 16) * (Math.PI / 2); pts.push(new THREE.Vector3(cx + Math.cos(a) * R, 0, cz + Math.sin(a) * R)); }
  };
  const X = SIDE_X - R, ZF = FRONT_Z - R, ZB = BACK_Z + R;
  line(-X, FRONT_Z, X, FRONT_Z);
  arc(X, ZF, Math.PI / 2);
  line(SIDE_X, ZF, SIDE_X, ZB);
  arc(X, ZB, 0);
  line(X, BACK_Z, -X, BACK_Z);
  arc(-X, ZB, -Math.PI / 2);
  line(-SIDE_X, ZB, -SIDE_X, ZF);
  arc(-X, ZF, -Math.PI);
  const cum = [0];
  for (let k = 1; k <= pts.length; k++) cum.push(cum[k - 1] + pts[k - 1].distanceTo(pts[k % pts.length]));
  const S = cum[pts.length];
  // where things are along the line
  const sAt = (pred: (p: THREE.Vector3) => boolean) => cum[pts.findIndex(pred)];
  const sFrontEnd = sAt((p) => p.x >= X - 0.01 && Math.abs(p.z - FRONT_Z) < 0.01);
  const sEastTop = sAt((p) => p.x === SIDE_X && p.z <= -6);
  const sBack = sAt((p) => p.z === BACK_Z);
  let lastBack = 0;
  pts.forEach((p, k) => { if (p.z === BACK_Z) lastBack = k; });
  const sBackEnd = cum[lastBack];
  const sWestTop = sAt((p) => p.x === -SIDE_X && p.z >= -6);
  const smooth = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  const heightAt = (s: number, x: number) => {
    if (s <= sFrontEnd) return LOW;
    if (s <= sEastTop) return LOW + (HIGH - LOW) * smooth((s - sFrontEnd) / (sEastTop - sFrontEnd));
    if (s >= sBack && s <= sBackEnd) {
      const ax = Math.abs(x);
      return ax <= KEEP_HALF ? KEEP_Y : ax >= TOWER[0] ? HIGH : KEEP_Y + (HIGH - KEEP_Y) * ((ax - KEEP_HALF) / (TOWER[0] - KEEP_HALF));
    }
    if (s <= sWestTop) return HIGH;
    return HIGH + (LOW - HIGH) * smooth((s - sWestTop) / (S - sWestTop));
  };
  pts.forEach((p, k) => (p.y = heightAt(cum[k], p.x)));
  const tmp = new THREE.Vector3();
  // a point on the line s metres from the start (wraps round)
  const at = (s: number, out = tmp) => {
    s = ((s % S) + S) % S;
    let lo = 0, hi = pts.length;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[(lo + 1) % pts.length], t = (s - cum[lo]) / (cum[lo + 1] - cum[lo]);
    return out.copy(a).lerp(b, t);
  };
  return { pts, cum, S, at, sFrontEnd, sEastTop, sBack, sBackEnd, sWestTop };
}

export function buildTrain(groundY: (x: number, z: number, top: number) => number) {
  const path = buildPath();
  const { S } = path;
  const root = new THREE.Group();
  const solid: Box[] = [], walk: Box[] = [], ramps: Ramp[] = [], lifts: Lift[] = [];
  // screen doors along the platform edges: solid unless the train is standing there with its doors open
  const gates: { box: Box; station: number }[] = [];

  /* ----- stations (s = the line position of the platform's middle) ----- */
  const sOf = (x: number, z: number) => {
    let best = 0, bd = Infinity;
    path.pts.forEach((p, k) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = path.cum[k]; } });
    return best;
  };
    const stations: Station[] = [
    { name: "GATE WEST", s: sOf(-50, FRONT_Z), side: -1, lift: false, laps: [1] },
    { name: "GATE EAST", s: sOf(50, FRONT_Z), side: -1, lift: false, laps: [0] },
    { name: "BACK EAST", s: sOf(SIDE_X, -32), side: -1, lift: true, laps: [1] },
    { name: "KEEP HALT", s: sOf(0, BACK_Z), side: 0, lift: false, laps: [1] },
    { name: "BACK WEST", s: sOf(-SIDE_X, -32), side: -1, lift: true, laps: [0] },
  ];

  /* ----- timetable: drive two laps once, sampling where the head of the train is ----- */
  const stops = stations.flatMap((st, i) => st.laps.map((lap) => ({ s: st.s + TRAIN_L / 2 + lap * S, i }))).sort((a, b) => a.s - b.s);
  const zones = [0, 1].flatMap((lap) => stations.map((st, i) => ({ a: st.s - TRAIN_L / 2 - 12 + lap * S, b: st.s + TRAIN_L / 2 + 12 + lap * S, i, lap })));
  const samples: number[] = [];
  const events: { t: number; i: number }[] = []; // a stop: when the train came to rest, at which station
  const passes: { t: number; i: number; stop: boolean }[] = [];
  {
    let s = 0, v = CRUISE, t = 0, dwell = 0, next = 0;
    const crossed = new Set<number>();
    while (s < 2 * S) {
      samples.push(s);
      t += DT;
      if (dwell > 0) { dwell -= DT; continue; }
      const stop = stops[next];
      const dist = stop ? stop.s - s : Infinity;
      let target = Math.min(CRUISE, Math.sqrt(2 * ACC * Math.max(0, dist)));
      for (const z of zones) {
        if (stops.some((q) => Math.abs(q.s - (stations[z.i].s + TRAIN_L / 2 + z.lap * S)) < 0.01)) continue; // it stops there anyway
        if (s > z.b) continue;
        target = Math.min(target, Math.sqrt(PASS * PASS + 2 * ACC * Math.max(0, z.a - s)));
      }
      v = v < target ? Math.min(target, v + ACC * DT) : target;
      s += v * DT;
      stations.forEach((st, i) => [0, 1].forEach((lap) => {
        const key = i * 2 + lap, at = st.s + TRAIN_L / 2 + lap * S;
        if (!crossed.has(key) && s >= at - 0.06) { crossed.add(key); passes.push({ t, i, stop: !!stop && Math.abs(stop.s - at) < 0.01 }); }
      }));
      if (stop && s >= stop.s - 0.05) { s = stop.s; v = 0; dwell = DWELL; events.push({ t, i: stop.i }); next++; }
    }
  }
  const P = samples.length * DT; // seconds for two laps
  // ?tt=<seconds> freezes the train at that point of its timetable (for checking things)
  const frozen = import.meta.env.DEV ? new URLSearchParams(location.search).get("tt") : null;
  const clock = () => (frozen !== null ? Number(frozen) : ((Date.now() / 1000) % P + P) % P);

  /* ----- materials ----- */
  const body = new THREE.MeshPhongMaterial({ color: 0x23262e, shininess: 120, specular: 0x8a98aa, emissive: 0x0a0b0e });
  const red = new THREE.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false });
  const white = new THREE.MeshBasicMaterial({ color: 0xfff2e0, toneMapped: false });
  const glass = new THREE.MeshBasicMaterial({ color: 0x5a86b0, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  const floorM = new THREE.MeshLambertMaterial({ color: 0x3a3d46, emissive: 0x1a1c22 });
  const seatM = new THREE.MeshLambertMaterial({ color: 0x7e1c17, emissive: 0x2a0806 });
  const lining = new THREE.MeshBasicMaterial({ color: 0x2a2f3a });
  const stone = new THREE.MeshLambertMaterial({ color: 0x2c2b31 });
  const steel = new THREE.MeshPhongMaterial({ color: 0x1a1c22, shininess: 60 });

  /* ----- the viaduct: a deck with glowing rails, on pillars ----- */
  {
    const deck: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [], posts: THREE.BufferGeometry[] = [];
    const inBuilding = (p: THREE.Vector3) => p.z === BACK_Z && (Math.abs(p.x) < KEEP_HALF || (Math.abs(p.x) > TOWER[0] && Math.abs(p.x) < TOWER[1]));
    const a = new THREE.Vector3(), b = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const STEP = 3;
    for (let s = 0; s < S; s += STEP) {
      path.at(s, a);
      path.at(s + STEP, b);
      const mid = a.clone().lerp(b, 0.5), len = a.distanceTo(b) + 0.05;
      const yaw = Math.atan2(b.x - a.x, b.z - a.z), pitch = -Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
      q.setFromEuler(e.set(pitch, yaw, 0, "YXZ"));
      if (inBuilding(mid)) {
        // through the rooms: only two rails set into the floor
        for (const sx of [-0.75, 0.75]) rails.push(new THREE.BoxGeometry(0.12, 0.03, len).applyMatrix4(m.compose(mid.clone().add(new THREE.Vector3(Math.cos(yaw) * sx, 0.02, -Math.sin(yaw) * sx)), q, new THREE.Vector3(1, 1, 1))));
        continue;
      }
      deck.push(new THREE.BoxGeometry(4, 0.7, len).applyMatrix4(m.compose(mid.clone().setY(mid.y - 1.5), q, new THREE.Vector3(1, 1, 1))));
      for (const sx of [-0.75, 0.75, -2, 2]) rails.push(new THREE.BoxGeometry(Math.abs(sx) > 1 ? 0.08 : 0.12, 0.06, len).applyMatrix4(m.compose(mid.clone().add(new THREE.Vector3(Math.cos(yaw) * sx, -1.13, -Math.sin(yaw) * sx)), q, new THREE.Vector3(1, 1, 1))));
      // a pillar every 15 m, down to whatever is underneath (not over the street)
      if (Math.round(s / STEP) % 5 === 0 && !(mid.z === FRONT_Z && Math.abs(mid.x) < 17)) {
        const top = mid.y - 1.6, base = groundY(mid.x, mid.z, top - 1), h = top - base;
        if (h > 1) {
          posts.push(new THREE.BoxGeometry(1.3, h, 1.3).translate(mid.x, base + h / 2, mid.z));
          posts.push(new THREE.BoxGeometry(3.4, 0.6, 1.6).translate(mid.x, top - 0.3, mid.z).applyMatrix4(new THREE.Matrix4()));
          solid.push({ x0: mid.x - 0.65, x1: mid.x + 0.65, z0: mid.z - 0.65, z1: mid.z + 0.65, y0: base, y1: top });
        }
      }
    }
    root.add(new THREE.Mesh(mergeGeometries(deck), stone), new THREE.Mesh(mergeGeometries(rails), red), new THREE.Mesh(mergeGeometries(posts), stone));
  }

  /* ----- one car, built once and shared: floor at y 0, forward = +z ----- */
  const carGeo = (nose: boolean) => {
    const parts: Record<"body" | "red" | "white" | "glass" | "floor" | "seat" | "lining", THREE.BufferGeometry[]> = { body: [], red: [], white: [], glass: [], floor: [], seat: [], lining: [] };
    const bx = (k: keyof typeof parts, w: number, h: number, d: number, x: number, y: number, z: number) => parts[k].push(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z));
    const L = CAR_L, W = CAR_W, hw = W / 2;
    bx("floor", W, 0.2, L, 0, -0.2, 0);
    bx("body", W - 0.3, 0.6, L - 0.4, 0, -0.75, 0); // skirt
    // side walls: below the windows, a window band, above, with two door openings each side
    const segs = [[-L / 2, -DOOR_Z - DOOR_W / 2], [-DOOR_Z + DOOR_W / 2, DOOR_Z - DOOR_W / 2], [DOOR_Z + DOOR_W / 2, L / 2]];
    for (const sx of [-1, 1]) {
      for (const [z0, z1] of segs) {
        bx("body", 0.1, 1.0, z1 - z0, sx * (hw - 0.05), 0, (z0 + z1) / 2);
        bx("glass", 0.04, 1.3, z1 - z0, sx * (hw - 0.05), 1.0, (z0 + z1) / 2);
        bx("red", 0.04, 0.07, z1 - z0, sx * (hw + 0.01), 0.92, (z0 + z1) / 2); // the red light line
      }
      bx("body", 0.1, 0.4, L, sx * (hw - 0.05), DOOR_H, 0);
    }
    // roof: flat ceiling plus a low rounded top, a light strip inside
    bx("body", W, 0.12, L, 0, 2.7, 0);
    parts.body.push(new THREE.CylinderGeometry(hw, hw, L, 16, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).scale(1, 0.3, 1).translate(0, 2.8, 0));
    bx("white", 0.5, 0.04, L - 1, 0, 2.64, 0);
    // a lit lining inside, under the windows
    for (const sx of [-1, 1]) for (const [z0, z1] of segs) bx("lining", 0.02, 0.9, z1 - z0 - 0.2, sx * (hw - 0.12), 0.05, (z0 + z1) / 2);
    for (const sx of [-1, 1]) bx("red", 0.06, 0.06, L, sx * (hw - 0.15), 3.0, 0);
    // ends with a gangway opening
    for (const sz of [-1, 1]) {
      bx("body", (W - 1.2) / 2, 2.7, 0.1, -(hw - (W - 1.2) / 4), 0, sz * (L / 2 - 0.05));
      bx("body", (W - 1.2) / 2, 2.7, 0.1, hw - (W - 1.2) / 4, 0, sz * (L / 2 - 0.05));
      bx("body", 1.2, 0.5, 0.1, 0, 2.2, sz * (L / 2 - 0.05));
    }
    // seats along the walls in the middle section
    for (const sx of [-1, 1]) {
      bx("seat", 0.55, 0.45, 2, sx * (hw - 0.4), 0, 0);
      bx("seat", 0.12, 0.6, 2, sx * (hw - 0.14), 0.45, 0);
    }
    // bogies, with glowing red hub rings
    for (const sz of [-1, 1]) {
      bx("body", W - 0.7, 0.35, 2.2, 0, -1.15, sz * (L / 2 - 1.4));
      for (const sx of [-1, 1]) for (const dz of [-0.6, 0.6])
        parts.red.push(new THREE.TorusGeometry(0.28, 0.05, 6, 14).rotateY(Math.PI / 2).translate(sx * (hw - 0.33), -1.0, sz * (L / 2 - 1.4) + dz));
    }
    // a storm emblem on each side
    if (nose) {
      // a raked nose: a wedge whose top slopes down to the front, headlights and a red brow
      const g = new THREE.BoxGeometry(W - 0.1, 3.0, 2.4, 1, 1, 1);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        if (p.getZ(k) > 0 && p.getY(k) > 0) { p.setZ(k, p.getZ(k) - 2.0); p.setY(k, p.getY(k) - 0.5); }
        if (p.getZ(k) > 0 && p.getY(k) < 0) p.setX(k, p.getX(k) * 0.85);
      }
      g.computeVertexNormals();
      parts.body.push(g.translate(0, 0.55, L / 2 + 1.2));
      for (const sx of [-1, 1]) bx("white", 0.5, 0.18, 0.05, sx * 0.85, 0.2, L / 2 + 2.42);
      bx("red", W - 0.4, 0.08, 0.05, 0, 0.55, L / 2 + 2.42);
    }
    const mats = { body, red, white, glass, floor: floorM, seat: seatM, lining };
    return (Object.keys(parts) as (keyof typeof parts)[]).map((k) => ({ geo: mergeGeometries(parts[k]), mat: mats[k] }));
  };
  const plain = carGeo(false), head = carGeo(true);
  const doorGeo = new THREE.BoxGeometry(0.06, DOOR_H, DOOR_W);
  const cars: { g: THREE.Group; doors: THREE.Mesh[]; state: TrainCar }[] = [];
  for (let i = 0; i < CARS; i++) {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    for (const { geo, mat } of i === 0 || i === CARS - 1 ? head : plain) inner.add(new THREE.Mesh(geo, mat));
    if (i === CARS - 1) inner.rotation.y = Math.PI; // the tail mirrors the head
    g.add(inner);
    const doors: THREE.Mesh[] = [];
    for (const sx of [-1, 1]) for (const dz of [-DOOR_Z, DOOR_Z]) {
      const d = new THREE.Mesh(doorGeo, body);
      d.position.set(sx * (CAR_W / 2 - 0.05), DOOR_H / 2, dz);
      d.userData = { sx, dz };
      g.add(d);
      doors.push(d);
    }
    root.add(g);
    cars.push({ g, doors, state: { pos: new THREE.Vector3(), yaw: 0, pitch: 0, open: 0, i } });
  }

  /* ----- stations ----- */
  const boards: { st: number; tex: THREE.CanvasTexture; canvas: HTMLCanvasElement; last: string }[] = [];
  const screenDoors: { mesh: THREE.Mesh; st: number }[] = [];
  const canopy = new THREE.MeshPhongMaterial({ color: 0x15161c, shininess: 40 });
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  stations.forEach((st, si) => {
    if (st.side === 0) return; // the Keep Halt is the War Room floor itself
    path.at(st.s, v);
    path.at(st.s + 1, w);
    const fx = w.x - v.x, fz = w.z - v.z, f = Math.hypot(fx, fz), ux = fx / f, uz = fz / f; // forward
    // the platform is on the car's local -x side, which is the right of travel: (-uz, ux)
    const ox = -uz, oz = ux, y = v.y, PW = 3.8, PL = TRAIN_L + 2, off = CAR_W / 2 + 0.15;
    const cx = v.x + ox * (off + PW / 2), cz = v.z + oz * (off + PW / 2);
    const alongX = Math.abs(ux) > 0.5; // the platform runs along x (front) or z (sides)
    const bx = (sx: number, sz: number) => (alongX ? [sx, sz] : [sz, sx]);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, yy: number, z: number) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, yy, z); root.add(m); return m; };
    const [pw, pd] = bx(PL, PW);
    add(new THREE.BoxGeometry(pw, 0.8, pd), stone, cx, y - 0.4, cz);
    walk.push({ x0: cx - pw / 2, x1: cx + pw / 2, z0: cz - pd / 2, z1: cz + pd / 2, y0: y - 0.8, y1: y });
    // a yellow-red safety line, canopy on posts, a glowing name sign and benches
    const ex = v.x + ox * (off + 0.35), ez = v.z + oz * (off + 0.35);
    { const [a, b] = bx(PL, 0.25); add(new THREE.BoxGeometry(a, 0.02, b), red, ex, y + 0.01, ez); }
    { const [a, b] = bx(PL, PW + 0.6); add(new THREE.BoxGeometry(a, 0.25, b), canopy, cx, y + 4.2, cz); }
    { const [a, b] = bx(PL, 0.1); add(new THREE.BoxGeometry(a, 0.1, b), red, cx + ox * (PW / 2 + 0.3), y + 4.1, cz + oz * (PW / 2 + 0.3)); }
    for (let k = -3; k <= 3; k++) {
      const px = cx + ux * k * 9 + ox * (PW / 2 - 0.3), pz = cz + uz * k * 9 + oz * (PW / 2 - 0.3);
      add(new THREE.BoxGeometry(0.3, 4.2, 0.3), steel, px, y + 2.1, pz);
      solid.push({ x0: px - 0.2, x1: px + 0.2, z0: pz - 0.2, z1: pz + 0.2, y0: y, y1: y + 4.2 });
      if (k !== 0 && Math.abs(k) !== 3) { const [a, b] = bx(2.4, 0.6); add(new THREE.BoxGeometry(a, 0.45, b), seatM, px - ox * 0.6, y + 0.22, pz - oz * 0.6); }
    }
    // the outer edge: a rail you can't climb over (a gap for the lift)
    {
      const rx = cx + ox * (PW / 2 - 0.05), rz = cz + oz * (PW / 2 - 0.05);
      const pieces = st.lift ? [[-PL / 2, -1.8], [1.8, PL / 2]] : [[-PL / 2, PL / 2]];
      for (const [a0, a1] of pieces) {
        const mx = rx + ux * (a0 + a1) / 2, mz = rz + uz * (a0 + a1) / 2, [a, b] = bx(a1 - a0, 0.12);
        add(new THREE.BoxGeometry(a, 1.1, b), glass, mx, y + 0.55, mz);
        add(new THREE.BoxGeometry(a, 0.08, b), red, mx, y + 1.12, mz);
        solid.push({ x0: mx - a / 2, x1: mx + a / 2, z0: mz - b / 2, z1: mz + b / 2, y0: y, y1: y + 1.15 });
      }
    }
    // platform screen doors along the track edge: glass with a gap at every car door
    const sx0 = v.x + ox * (off + 0.08), sz0 = v.z + oz * (off + 0.08);
    const doorAt: number[] = [];
    for (let i = 0; i < CARS; i++) { const c = (CARS - 1) / 2 - i; for (const dz of [-DOOR_Z, DOOR_Z]) doorAt.push(c * PITCH + dz); } // along the platform (forward +)
    doorAt.sort((a, b) => a - b);
    let from = -PL / 2;
    const edge = (a0: number, a1: number) => {
      if (a1 - a0 < 0.05) return;
      const mx = sx0 + ux * (a0 + a1) / 2, mz = sz0 + uz * (a0 + a1) / 2, [a, b] = bx(a1 - a0, 0.1);
      add(new THREE.BoxGeometry(a, 2.2, b), glass, mx, y + 1.1, mz);
      solid.push({ x0: mx - a / 2, x1: mx + a / 2, z0: mz - b / 2, z1: mz + b / 2, y0: y, y1: y + 2.2 });
    };
    for (const d of doorAt) {
      edge(from, d - DOOR_W / 2);
      const mx = sx0 + ux * d, mz = sz0 + uz * d, [a, b] = bx(DOOR_W, 0.12);
      const leaf = add(new THREE.BoxGeometry(a, 2.2, b), glass, mx, y + 1.1, mz);
      add(new THREE.BoxGeometry(a, 0.06, b), red, mx, y + 2.24, mz);
      screenDoors.push({ mesh: leaf, st: si });
      gates.push({ box: { x0: mx - a / 2, x1: mx + a / 2, z0: mz - b / 2, z1: mz + b / 2, y0: y, y1: y + 2.2 }, station: si });
      from = d + DOOR_W / 2;
    }
    edge(from, PL / 2);
    // the name sign and the departures board
    const sign = document.createElement("canvas");
    sign.width = 512; sign.height = 96;
    const g = sign.getContext("2d")!;
    g.fillStyle = "#07080c"; g.fillRect(0, 0, 512, 96);
    g.strokeStyle = "#ff2a3a"; g.lineWidth = 6; g.strokeRect(4, 4, 504, 88);
    g.fillStyle = "#fff"; g.font = "bold 52px Inter, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(st.name, 256, 50);
    const signTex = new THREE.CanvasTexture(sign);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const ry = Math.atan2(-ox, -oz); // facing the track
    // signs read the right way from both sides (two planes back to back, not one two-sided plane)
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false });
    for (const k of [-1, 1]) for (const back of [0, 1]) {
      const m = add(new THREE.PlaneGeometry(5, 0.95), signMat, cx + ux * k * 14 + ox * (0.2 + back * 0.02), y + 3.45, cz + uz * k * 14 + oz * (0.2 + back * 0.02));
      m.rotation.y = ry + back * Math.PI;
    }
    const bc = document.createElement("canvas");
    bc.width = 512; bc.height = 256;
    const bt = new THREE.CanvasTexture(bc);
    bt.colorSpace = THREE.SRGBColorSpace;
    const boardMat = new THREE.MeshBasicMaterial({ map: bt, toneMapped: false });
    for (const back of [0, 1]) add(new THREE.PlaneGeometry(3, 1.5), boardMat, cx + ox * (0.2 + back * 0.02), y + 3.0, cz + oz * (0.2 + back * 0.02)).rotation.y = ry + back * Math.PI;
    boards.push({ st: si, tex: bt, canvas: bc, last: "" });

    // getting up: a stair tower at the gate stations, a lift at the back ones
    if (!st.lift) {
      // at the platform's outer end: four flights of 3 m, switching back between two lanes
      // (at the end away from the street: forward for Gate East, backward for Gate West)
      const e = v.x > 0 ? 1 : -1;
      const end = PL / 2, gy = groundY(cx + ux * e * (end + 5), cz + uz * e * (end + 5), y - 1), rise = y - gy, n = 4, fr = rise / n, run = fr * 1.6, land = 2, lane = 1.8;
      const at = (a: number, o: number) => [cx + ux * a * e + ox * o, cz + uz * a * e + oz * o] as const;
      const laneO = [-PW / 2 + lane / 2 + 0.1, -PW / 2 + lane * 1.5 + 0.1]; // lane A (nearer the track), lane B
      const steps: THREE.BufferGeometry[] = [];
      for (let k = 0; k < n; k++) {
        const y0 = gy + k * fr, laneK = laneO[k % 2], up = k % 2 === 0; // A climbs away from the platform, B back toward it
        const a0 = up ? end + land : end + land + run, a1 = up ? end + land + run : end + land;
        const N = 12;
        for (let j = 0; j < N; j++) {
          const a = a0 + ((a1 - a0) * (j + 0.5)) / N, [px, pz] = at(a, laneK), [sw, sd] = bx(run / N + 0.02, lane);
          steps.push(new THREE.BoxGeometry(sw, fr * (j + 1) / N + 0.2, sd).translate(px, y0 - 0.2 + (fr * (j + 1) / N + 0.2) / 2, pz));
        }
        const [ax, az] = at(a0, laneK), [bx2, bz2] = at(a1, laneK);
        ramps.push({ ax, az, bx: bx2, bz: bz2, w: lane, ya: y0, yb: y0 + fr });
        // the landing at the end of this flight (both lanes)
        const la = up ? end + land + run + land / 2 : end + land / 2, [lx2, lz2] = at(la, (laneO[0] + laneO[1]) / 2), [lw, ld] = bx(land, lane * 2);
        const ly = y0 + fr;
        if (k < n - 1 || up) {
          steps.push(new THREE.BoxGeometry(lw, 0.3, ld).translate(lx2, ly - 0.15, lz2));
          walk.push({ x0: lx2 - lw / 2, x1: lx2 + lw / 2, z0: lz2 - ld / 2, z1: lz2 + ld / 2, y0: ly - 0.3, y1: ly });
        }
      }
      // the top landing joins the platform end (lane B ends there at platform height)
      { const [lx2, lz2] = at(end + land / 2, (laneO[0] + laneO[1]) / 2), [lw, ld] = bx(land, lane * 2); steps.push(new THREE.BoxGeometry(lw, 0.3, ld).translate(lx2, y - 0.15, lz2)); walk.push({ x0: lx2 - lw / 2, x1: lx2 + lw / 2, z0: lz2 - ld / 2, z1: lz2 + ld / 2, y0: y - 0.3, y1: y }); }
      root.add(new THREE.Mesh(mergeGeometries(steps), stone));
      // walls: between the lanes (open at the landings), along both sides, across the far end, and a
      // glass screen across the near end above head height (so you can't step off a landing)
      const wallBox = (a0: number, a1: number, o0: number, o1: number, y0: number, y1: number, mat: THREE.Material) => {
        const [p0x, p0z] = at(a0, o0), [p1x, p1z] = at(a1, o1);
        const x0 = Math.min(p0x, p1x), x1 = Math.max(p0x, p1x), z0 = Math.min(p0z, p1z), z1 = Math.max(p0z, p1z);
        add(new THREE.BoxGeometry(Math.max(0.1, x1 - x0), y1 - y0, Math.max(0.1, z1 - z0)), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        solid.push({ x0: x0 - 0.05, x1: x1 + 0.05, z0: z0 - 0.05, z1: z1 + 0.05, y0, y1 });
      };
      const o0 = laneO[0] - lane / 2, mid = laneO[0] + lane / 2, o1 = laneO[1] + lane / 2;
      wallBox(end + land, end + land + run, mid - 0.06, mid + 0.06, gy, y + 1.1, steel);
      wallBox(end, end + 2 * land + run, o0 - 0.1, o0, gy + 2.4, y + 1.1, glass);
      wallBox(end, end + 2 * land + run, o1, o1 + 0.1, gy, y + 1.1, glass);
      wallBox(end + 2 * land + run, end + 2 * land + run + 0.1, o0, o1, gy, y + 1.1, glass);
      wallBox(end - 0.1, end, o0, o1, gy + 2.6, y - 0.3, glass);
      // a neon "THUNDER LINE" strip up the tower
      const [tx, tz] = at(end + 2 * land + run + 0.15, (o0 + o1) / 2);
      add(new THREE.BoxGeometry(alongX ? 0.06 : 3.4, rise, alongX ? 3.4 : 0.06), red, tx, gy + rise / 2, tz).scale.set(alongX ? 1 : 0.1, 1, alongX ? 0.1 : 1);
    } else {
      // a glass lift on the outer side, from the ground up to the platform
      const lx = cx + ox * (PW / 2 + 1.6), lz = cz + oz * (PW / 2 + 1.6), gy = groundY(lx, lz, y - 1), half = 1.4;
      const lift: Lift = { x0: lx - half, x1: lx + half, z0: lz - half, z1: lz + half, stops: [gy, y], gates: [], at: gy };
      // the gate at the top faces the platform; the one at the bottom faces away
      const gate = (sgn: number, yy: number) => {
        const gx = lx - ox * sgn * half, gz = lz - oz * sgn * half;
        const box: Box = alongX
          ? { x0: gx - half, x1: gx + half, z0: gz - 0.05, z1: gz + 0.05, y0: yy, y1: yy + 2.4 }
          : { x0: gx - 0.05, x1: gx + 0.05, z0: gz - half, z1: gz + half, y0: yy, y1: yy + 2.4 };
        lift.gates.push({ box, stop: yy });
      };
      gate(1, y);
      gate(-1, gy);
      // a sill from the platform edge to the lift, so there's no gap to drop through
      {
        const ax = cx + ox * (PW / 2 - 0.2), az = cz + oz * (PW / 2 - 0.2), bxx = lx - ox * (half - 0.2), bzz = lz - oz * (half - 0.2);
        const b: Box = { x0: Math.min(ax, bxx) - Math.abs(oz) * half, x1: Math.max(ax, bxx) + Math.abs(oz) * half, z0: Math.min(az, bzz) - Math.abs(ox) * half, z1: Math.max(az, bzz) + Math.abs(ox) * half, y0: y - 0.3, y1: y };
        walk.push(b);
        add(new THREE.BoxGeometry(b.x1 - b.x0, 0.3, b.z1 - b.z0), steel, (b.x0 + b.x1) / 2, y - 0.15, (b.z0 + b.z1) / 2);
      }
      // shaft walls on the other two sides
      for (const sgn of [-1, 1]) {
        const wx = lx + ux * sgn * half, wz = lz + uz * sgn * half;
        const box: Box = alongX ? { x0: wx - 0.05, x1: wx + 0.05, z0: lz - half, z1: lz + half, y0: gy, y1: y + 2.6 } : { x0: lx - half, x1: lx + half, z0: wz - 0.05, z1: wz + 0.05, y0: gy, y1: y + 2.6 };
        solid.push(box);
        add(new THREE.BoxGeometry(box.x1 - box.x0, box.y1 - box.y0, box.z1 - box.z0), glass, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2);
      }
      for (const [px, pz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) add(new THREE.BoxGeometry(0.2, y + 3 - gy, 0.2), steel, lx + px * half, (gy + y + 3) / 2, lz + pz * half);
      add(new THREE.BoxGeometry(2 * half + 0.4, 0.3, 2 * half + 0.4), steel, lx, y + 3, lz);
      const plat = add(new THREE.BoxGeometry(2 * half - 0.1, 0.2, 2 * half - 0.1), steel, lx, gy - 0.1, lz);
      plat.add(new THREE.Mesh(new THREE.BoxGeometry(2 * half - 0.3, 0.03, 2 * half - 0.3), red).translateY(0.11));
      lift.gates.forEach((gt) => add(new THREE.BoxGeometry(gt.box.x1 - gt.box.x0, 0.08, gt.box.z1 - gt.box.z0), red, (gt.box.x0 + gt.box.x1) / 2, gt.box.y0 + 2.4, (gt.box.z0 + gt.box.z1) / 2));
      lifts.push(lift);
      liftMeshes.push({ lift, plat });
    }
  });

  /* ----- every frame ----- */
  const liftSpeed = 4, liftWait = 5;
  function liftAt(l: Lift) {
    const [a, b] = l.stops, travel = (b - a) / liftSpeed, period = 2 * (travel + liftWait);
    const t = ((Date.now() / 1000) % period + period) % period;
    if (t < liftWait) return a;
    if (t < liftWait + travel) return a + (t - liftWait) * liftSpeed;
    if (t < 2 * liftWait + travel) return b;
    return b - (t - 2 * liftWait - travel) * liftSpeed;
  }
  let current = -1; // the station the train is standing at, or -1
  let openNow = 0;
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
  function update() {
    const tt = clock();
    const k = Math.min(samples.length - 1, Math.floor(tt / DT)), f = tt / DT - k;
    const headS = samples[k] + ((samples[(k + 1) % samples.length] - samples[k] + 2 * S) % (2 * S)) * f;
    // doors: open while standing at a stop (a moment after arriving, shut a little before leaving)
    current = -1;
    openNow = 0;
    for (const ev of events) if (tt >= ev.t && tt < ev.t + DWELL) {
      current = ev.i;
      openNow = THREE.MathUtils.clamp(Math.min(tt - ev.t - 0.8, ev.t + DWELL - 1.5 - tt), 0, 1);
    }
    for (let i = 0; i < CARS; i++) {
      const c = cars[i], sc = headS - (i + 0.5) * PITCH;
      path.at(sc + CAR_L / 2 - 1.2, p0);
      path.at(sc - CAR_L / 2 + 1.2, p1);
      c.state.pos.copy(p0).lerp(p1, 0.5);
      c.state.yaw = Math.atan2(p0.x - p1.x, p0.z - p1.z);
      c.state.pitch = -Math.atan2(p0.y - p1.y, Math.hypot(p0.x - p1.x, p0.z - p1.z));
      c.g.position.copy(c.state.pos);
      c.g.rotation.set(c.state.pitch, c.state.yaw, 0, "YXZ");
      const st = current >= 0 ? stations[current] : null;
      c.state.open = openNow;
      for (const d of c.doors) {
        // only the doors on the platform side open (both sides at the Keep Halt)
        const side = d.userData.sx as number, ok = !!st && (st.side === 0 || side === st.side);
        const o = ok ? openNow : 0;
        d.position.set(side * (CAR_W / 2 + 0.04 * o), DOOR_H / 2, (d.userData.dz as number) + Math.sign(d.userData.dz as number) * 1.65 * o);
      }
    }
    for (const sd of screenDoors) sd.mesh.visible = !(sd.st === current && openNow > 0.5);
    for (const lm of liftMeshes) { lm.lift.at = liftAt(lm.lift); lm.plat.position.y = lm.lift.at - 0.1; }
    // departure boards, once a second
    const sec = Math.floor(tt);
    for (const b of boards) {
      let next = passes.find((p) => p.i === b.st && p.t > tt) ?? passes.find((p) => p.i === b.st);
      if (!next) continue;
      const wait = ((next.t - tt) % P + P) % P, here = current === b.st;
      const key = here + "|" + sec;
      if (key === b.last) continue;
      b.last = key;
      const g = b.canvas.getContext("2d")!;
      g.fillStyle = "#06070b"; g.fillRect(0, 0, 512, 256);
      g.fillStyle = "#ff2a3a"; g.fillRect(0, 0, 512, 46);
      g.fillStyle = "#fff"; g.font = "bold 28px Inter, Arial, sans-serif"; g.textBaseline = "middle"; g.textAlign = "left";
      g.fillText("THUNDER LINE", 16, 24);
      g.font = "bold 40px Inter, Arial, sans-serif";
      if (here) {
        g.fillStyle = "#3dff7a"; g.fillText("BOARDING NOW", 16, 110);
        g.fillStyle = "#c9c2d8"; g.font = "26px Inter, Arial, sans-serif"; g.fillText("Doors close soon", 16, 170);
      } else {
        const m = Math.floor(wait / 60), s = Math.floor(wait % 60);
        g.fillStyle = "#fff"; g.fillText(`Next train ${m}:${String(s).padStart(2, "0")}`, 16, 100);
        g.fillStyle = next.stop ? "#3dff7a" : "#ffc94a"; g.font = "bold 32px Inter, Arial, sans-serif";
        g.fillText(next.stop ? "STOPS HERE" : "PASSING THROUGH", 16, 160);
        const after = passes.find((p) => p.i === b.st && p.stop && ((p.t - tt) % P + P) % P > wait);
        if (!next.stop && after) { const aw = ((after.t - tt) % P + P) % P; g.fillStyle = "#8a83a0"; g.font = "24px Inter, Arial, sans-serif"; g.fillText(`Next stop here in ${Math.floor(aw / 60)}:${String(Math.floor(aw % 60)).padStart(2, "0")}`, 16, 214); }
      }
      b.tex.needsUpdate = true;
    }
  }

  /* ----- riding: you stand on a car's floor; it carries you; its walls keep you in unless a door is open ----- */
  const local = (c: TrainCar, x: number, z: number) => {
    const dx = x - c.pos.x, dz = z - c.pos.z, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    return { lx: dx * cy - dz * sy, lz: dx * sy + dz * cy };
  };
  const world = (c: TrainCar, lx: number, lz: number, out: THREE.Vector3) => {
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    out.x = c.pos.x + lx * cy + lz * sy;
    out.z = c.pos.z - lx * sy + lz * cy;
    return out;
  };
  const floorY = (c: TrainCar, lz: number) => c.pos.y - Math.tan(c.pitch) * lz;
  const inCar = (c: TrainCar, x: number, z: number, y: number) => {
    const { lx, lz } = local(c, x, z);
    return Math.abs(lx) < CAR_W / 2 && Math.abs(lz) < CAR_L / 2 + 0.35 && Math.abs(y - floorY(c, lz)) < 1.2 ? { lx, lz } : null;
  };
  // the car floor under (x, z) at or just below y
  function floorAt(x: number, z: number, y: number, step: number) {
    let best = -Infinity;
    for (const { state: c } of cars) {
      const q = inCar(c, x, z, y);
      if (!q) continue;
      const fy = floorY(c, q.lz);
      if (fy <= y + step && fy > best) best = fy;
    }
    return best;
  }
  let rider: { car: number; lx: number; lz: number; y: number; yaw: number } | null = null;
  // before moving: carry the player along with the car they stood in last frame
  // returns how far the car turned since then, so the view can turn with it
  function carry(p: THREE.Vector3) {
    if (!rider) return 0;
    const c = cars[rider.car].state;
    world(c, rider.lx, rider.lz, p);
    p.y = floorY(c, rider.lz) + rider.y;
    return Math.atan2(Math.sin(c.yaw - rider.yaw), Math.cos(c.yaw - rider.yaw));
  }
  // after moving and colliding: keep a rider inside the car, unless they step out of an open door
  function confine(p: THREE.Vector3) {
    for (const { state: c } of cars) {
      const q = inCar(c, p.x, p.z, p.y);
      if (!q) continue;
      let { lx, lz } = q;
      const st = current >= 0 ? stations[current] : null;
      const doorOpen = (side: number) => !!st && c.open > 0.6 && (st.side === 0 || side === st.side) && (Math.abs(lz - DOOR_Z) < DOOR_W / 2 - 0.3 || Math.abs(lz + DOOR_Z) < DOOR_W / 2 - 0.3);
      const lim = CAR_W / 2 - 0.42;
      if (lx > lim && !doorOpen(1)) lx = lim;
      if (lx < -lim && !doorOpen(-1)) lx = -lim;
      const endLim = CAR_L / 2 - 0.42, gangway = Math.abs(lx) < 0.45;
      if (lz > endLim && (c.i === 0 || !gangway)) lz = endLim;
      if (lz < -endLim && (c.i === CARS - 1 || !gangway)) lz = -endLim;
      if (lx !== q.lx || lz !== q.lz) world(c, lx, lz, p);
      return;
    }
  }
  // at the end of the frame: remember where in which car the player stands
  function remember(p: THREE.Vector3, grounded: boolean) {
    rider = null;
    for (const { state: c } of cars) {
      const q = inCar(c, p.x, p.z, p.y);
      if (!q) continue;
      const dy = p.y - floorY(c, q.lz);
      if (dy < -0.05 || (grounded && dy > 0.05)) continue;
      rider = { car: c.i, lx: q.lx, lz: q.lz, y: Math.max(0, dy), yaw: c.yaw };
      return;
    }
  }
  // screen doors are shut unless the train stands at that platform with its doors open
  const shut = (st: number) => !(st === current && openNow > 0.5);

  return { debug: { events, passes, P, stations: stations.map((x) => x.name) }, root, solid, walk, ramps, lifts, gates, shut, update, floorAt, carry, confine, remember, riding: () => rider !== null, drop: () => { rider = null; }, cars: () => cars.map((c) => c.state) };
}
const liftMeshes: { lift: Lift; plat: THREE.Mesh }[] = [];
