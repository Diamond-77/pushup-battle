// Cyber suit parts for the explorer, built procedurally (low-poly, flat shaded).
// Developed one part at a time in the Part Lab against the character sheet, then copied here.
// Every part is built once as a template; Hero clones them (geometry and materials are shared).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";

const CYAN = new THREE.Color('#3ef0ee');
const M = {
  helmet: new THREE.MeshStandardMaterial({ color: '#07080b', roughness: 0.22, metalness: 0.45 }),
  rimDark: new THREE.MeshStandardMaterial({ color: '#2b2e36', roughness: 0.5, metalness: 0.2, flatShading: true }),
  rimGrey: new THREE.MeshStandardMaterial({ color: '#8d919b', roughness: 0.45, metalness: 0.2, flatShading: true }),
  suit: new THREE.MeshStandardMaterial({ color: '#16171b', roughness: 0.7, metalness: 0.05, flatShading: true }),
  glow: new THREE.MeshBasicMaterial({ color: CYAN, toneMapped: false }),
  halo: new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
};

// ------------------------------------------------------------------ helmet
// unit-sphere sculpt: round skull, flat face plate, jaw tapering to a narrow, slightly squared chin
const HS = new THREE.Vector3(0.098, 0.136, 0.118);
const head = new THREE.Group();
const shell = (() => {
  const g = new THREE.SphereGeometry(1, 48, 36);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // jaw taper below the eyes
    const f = THREE.MathUtils.clamp((0.1 - y) / 1.1, 0, 1);
    x *= 1 - 0.5 * f * f - 0.1 * f;
    // face plate: flatten the front, a little forward lean at the chin
    if (z > 0) z = Math.min(z, 0.84 + 0.1 * f) * (1 - 0.1 * f) + 0.06 * f;
    // back of skull slightly fuller, nape tucked
    if (z < 0) z *= (y > -0.2 ? 1.04 : 1 - 0.35 * f);
    // squared chin
    if (y < -0.82) y = -0.82 - (y + 0.82) * 0.45;
    p.setXYZ(i, x * HS.x, y * HS.y, z * HS.z);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, M.helmet);
})();
head.add(shell);
// neck
const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.046, 0.1, 16), M.suit); neck.position.set(0, -0.16, -0.025); head.add(neck);

// raycast onto the shell from outside, aiming at the head centre
head.updateMatrixWorld(true);
const rc = new THREE.Raycaster();
function onShell(x, y, fromFront = true) {
  const o = fromFront ? new THREE.Vector3(x * HS.x, y * HS.y, 1) : new THREE.Vector3(x * 3, y * HS.y, 0);
  const d = fromFront ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(-Math.sign(x), 0, 0);
  rc.set(o, d); const h = rc.intersectObject(shell, false)[0];
  if (!h) return null;
  const n = h.face.normal.clone().transformDirection(shell.matrixWorld);
  return { p: h.point, n };
}
// visor line: temple -> down the cheek -> small step -> diagonal to the chin -> across the chin, mirrored
function visorPath() {
  const half = [[0.6, 0.12], [0.6, -0.28], [0.66, -0.36], [0.5, -0.62], [0.28, -0.8]];
  const pts = [];
  for (const [x, y] of half.slice().reverse()) pts.push([-x, y]);
  for (const [x, y] of half) pts.push([x, y]);
  // reorder: left temple ... chin ... right temple
  const left = half.map(([x, y]) => [-x, y]);
  const right = half.slice().reverse().map(([x, y]) => [x, y]);
  return left.concat(right);
}
function strip(path2d, r = 0.0032) {
  const pts = path2d.map(([x, y]) => { const h = onShell(x, y); return h ? h.p.clone().addScaledVector(h.n, 0.0015) : null; }).filter(Boolean);
  // sharp corners: a polyline curve
  const curve = new THREE.CurvePath();
  for (let i = 0; i < pts.length - 1; i++) curve.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
  const segs = (pts.length - 1) * 8;
  head.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, r, 6, false), M.glow));
  head.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, r * 2.2, 8, false), M.halo));
}
strip(visorPath());

// headphones: grey rim, dark cup, open cyan ring
for (const s of [1, -1]) {
  const ear = new THREE.Group(); head.add(ear);
  const h = onShell(s * 0.9, 0.08, false);
  ear.position.copy(h ? h.p : new THREE.Vector3(s * HS.x, 0.01, -0.01)); ear.position.z = -0.022; ear.position.y = 0.038; ear.position.x -= s * 0.006;
  ear.rotation.y = s * Math.PI / 2;
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.043, 0.02, 24), M.rimGrey); cup.rotation.x = Math.PI / 2; cup.position.z = 0.004; ear.add(cup);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.024, 24), M.rimDark); face.rotation.x = Math.PI / 2; face.position.z = 0.006; ear.add(face);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.028, 20), M.helmet); core.rotation.x = Math.PI / 2; core.position.z = 0.008; ear.add(core);
  const arc = new THREE.TorusGeometry(0.027, 0.003, 6, 40, Math.PI * 1.45);
  const ring = new THREE.Mesh(arc, M.glow); ring.position.z = 0.0185; ring.rotation.z = s > 0 ? -0.35 : Math.PI + 0.35 - Math.PI * 0.45; ear.add(ring);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.0065, 6, 40, Math.PI * 1.45), M.halo); halo.position.z = 0.019; halo.rotation.z = ring.rotation.z; ear.add(halo);
}

// ------------------------------------------------------------------ hair: folded paper-like blades layered like shingles
const hair = new THREE.Group(); head.add(hair);
const HAIR_MAT = new THREE.MeshLambertMaterial({ color: '#c9c6d4', emissive: '#4a4858', vertexColors: true, flatShading: true, side: THREE.DoubleSide });
const V = (x, y, z) => new THREE.Vector3(x, y, z);
let hseed = 11; const hr = (a, b) => { hseed = (hseed * 16807) % 2147483647; return a + (b - a) * (hseed / 2147483647); };
function S(az, el, k = 1) { // point on the helmet ellipsoid (az 0 = front, + = character's left / +x)
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  return V(Math.sin(a) * Math.cos(e) * HS.x * k, Math.sin(e) * HS.y * k, Math.cos(a) * Math.cos(e) * HS.z * k);
}
function N(az, el) { const p = S(az, el); return V(p.x / (HS.x * HS.x), p.y / (HS.y * HS.y), p.z / (HS.z * HS.z)).normalize(); }
const bladeGeos = [];
function blade({ root, dir, len, w, n, bend = V(0, 0, 0), ridge = 0.32, shade = 1, curl = null }) {
  dir = dir.clone().normalize();
  if (curl) bend = bend.clone().add(curl);
  const rows = 7, ring = [], pos = [], col = [], idx = [];
  const at = (t) => root.clone().addScaledVector(dir, len * t).addScaledVector(bend, len * t * t);
  for (let i = 0; i < rows; i++) {
    const t = i / rows;
    const c = at(t), T = at(Math.min(1, t + 0.02)).sub(at(Math.max(0, t - 0.02))).normalize();
    const side = new THREE.Vector3().crossVectors(T, n).normalize();
    const up = new THREE.Vector3().crossVectors(side, T).normalize();
    const hw = w * 0.5 * Math.pow(1 - t, 0.85) * (1 + 0.35 * Math.sin(Math.PI * t));
    const rh = w * ridge * Math.pow(1 - t, 0.8);
    const L = c.clone().addScaledVector(side, -hw), R = c.clone().addScaledVector(side, hw);
    const Tp = c.clone().addScaledVector(up, rh), B = c.clone().addScaledVector(up, -rh * 0.35);
    ring.push([L, Tp, R, B]);
  }
  const tip = at(1.0);
  const push = (v) => { pos.push(v.x, v.y, v.z); col.push(shade, shade, shade * 1.02); return pos.length / 3 - 1; };
  const ids = ring.map(r => r.map(push));
  const tipId = push(tip);
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < 4; j++) {
    const a = ids[i][j], b = ids[i][(j + 1) % 4], c = ids[i + 1][j], d = ids[i + 1][(j + 1) % 4];
    idx.push(a, c, b, b, c, d);
  }
  for (let j = 0; j < 4; j++) idx.push(ids[rows - 1][j], tipId, ids[rows - 1][(j + 1) % 4]);
  idx.push(ids[0][0], ids[0][1], ids[0][2], ids[0][0], ids[0][2], ids[0][3]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  bladeGeos.push(g);
}
// skull cap: faceted dome so nothing bald shows between blades (edge sits above the headphones)
{
  const cap = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.33);
  cap.rotateX(-0.32); cap.scale(HS.x * 1.06, HS.y * 1.05, HS.z * 1.06); cap.translate(0, 0.008, -0.004);
  const c = new Float32Array(cap.attributes.position.count * 3).fill(0.93);
  cap.setAttribute('color', new THREE.BufferAttribute(c, 3)); cap.deleteAttribute('uv');
  bladeGeos.push(cap);
}
// hair volume: an envelope a bit bigger than the skull; blades lie on it following a flow field
const EC = V(0.0, 0.012, -0.008), ER = V(0.112, 0.145, 0.13);
const E = (az, el, k = 1) => { const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  return V(Math.sin(a) * Math.cos(e) * ER.x * k, Math.sin(e) * ER.y * k, Math.cos(a) * Math.cos(e) * ER.z * k).add(EC); };
const EN = (az, el) => { const p = E(az, el).sub(EC); return V(p.x / (ER.x * ER.x), p.y / (ER.y * ER.y), p.z / (ER.z * ER.z)).normalize(); };
function flow(az, el) {
  const front = Math.abs(az) < 62, back = Math.abs(az) > 128;
  if (el > 66) return V(0.3, 0.35, -1);                      // top: back, lifting, leaning to +x
  if (front) return V(-0.42, -1, 0.25);                       // bangs: down over the forehead, toward -x
  if (back) return el > 38 ? V(0.1, 0.45, -1) : V(0, -1, -0.35); // crown back / nape
  return V(Math.sign(az) * 0.12, 0.12, -1);                   // sides: sweep back
}
const tangent = (v, n) => v.clone().addScaledVector(n, -v.dot(n)).normalize();
// Fibonacci points over the upper head, skipping the face and the headphones
const COUNT = 40;
for (let i = 0; i < COUNT; i++) {
  const yv = 1 - (i + 0.5) / COUNT * 1.25;          // from the top down to a bit below the equator
  const el = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(yv, -1, 1)));
  const az = THREE.MathUtils.radToDeg((i * 2.399963) % (Math.PI * 2)) - 180;
  const front = Math.abs(az) < 62, side = !front && Math.abs(az) < 128;
  if (front && el < 50) continue;                    // bangs are placed by hand below
  if (side && el < 46) continue;                     // keep the headphones clear
  if (el < 22) continue;
  const n = EN(az, el), f = tangent(flow(az, el), n);
  const lift = front ? 0.08 : el > 66 ? 0.32 : 0.22;
  const len = front ? THREE.MathUtils.clamp((el - 4) / 90 * 0.3, 0.07, 0.15) : el > 66 ? hr(0.15, 0.2) : hr(0.12, 0.15);
  const back = Math.abs(az) > 128;
  const curl = new THREE.Vector3().crossVectors(f, n).multiplyScalar(hr(-0.12, 0.12));
  blade({ root: E(az, el, 0.88), dir: f.clone().addScaledVector(n, lift), len: back ? len * 0.75 : len, w: hr(0.11, 0.135), n, curl,
    bend: front ? n.clone().multiplyScalar(0.25) : n.clone().multiplyScalar(0.18).add(V(0, 0.08, 0)), ridge: 0.28,
    shade: hr(0.84, 1.0) });
}
// bangs: big blades over the forehead, tips stopping at the top of the visor, sweeping to the character's right (-x)
for (const [az, L, sx, cu] of [[-42, 0.13, -0.75, -0.1], [-17, 0.17, -0.5, -0.12], [7, 0.175, -0.36, -0.1], [29, 0.15, -0.18, -0.06], [50, 0.12, 0.05, 0.04]]) {
  const el = 50, n = EN(az, 30);
  const f = tangent(V(sx, -1, 0.15), n);
  blade({ root: E(az, el, 0.9), dir: f.addScaledVector(n, 0.05), len: L, w: 0.125, n,
    bend: n.clone().multiplyScalar(0.3).add(new THREE.Vector3().crossVectors(f, n).multiplyScalar(cu)), ridge: 0.3, shade: hr(0.92, 1.0) });
}
// silhouette spikes: big blades breaking the outline, broad faces toward the front
for (const [az, el, L, d] of [[-25, 74, 0.2, V(-0.55, 1, -0.2)], [20, 80, 0.23, V(0.25, 1, -0.45)], [60, 70, 0.21, V(0.9, 0.8, -0.35)], [100, 62, 0.18, V(1, 0.35, -0.6)], [-80, 60, 0.17, V(-1, 0.3, -0.5)], [170, 66, 0.18, V(0.1, 0.8, -1)]]) {
  const n = EN(az, el).lerp(V(0, 0, 1), 0.35).normalize();
  blade({ root: E(az, el, 0.85), dir: d, len: L, w: 0.125, n, bend: V(0, -0.1, -0.12), ridge: 0.26, shade: hr(0.9, 1.0) });
}
const hairGeo = mergeGeometries(bladeGeos);
const hairMesh = new THREE.Mesh(hairGeo, HAIR_MAT); hair.add(hairMesh);

// ------------------------------------------------------------------ chest plate: black low-poly vest, high collar, white shard plate, sash
const chest = new THREE.Group();
const CM = {
  vest: new THREE.MeshStandardMaterial({ color: '#17181d', roughness: 0.62, metalness: 0.08, flatShading: true }),
  vestIn: new THREE.MeshStandardMaterial({ color: '#0c0d10', roughness: 0.8, flatShading: true, side: THREE.DoubleSide }),
  white: new THREE.MeshStandardMaterial({ color: '#dcdbe2', roughness: 0.48, metalness: 0.05, flatShading: true, side: THREE.DoubleSide }),
  whiteSide: new THREE.MeshStandardMaterial({ color: '#9c9aa6', roughness: 0.55, flatShading: true, side: THREE.DoubleSide }),
  grey: new THREE.MeshStandardMaterial({ color: '#3a3c44', roughness: 0.5, metalness: 0.2, flatShading: true }),
  ink: new THREE.MeshBasicMaterial({ color: '#121318' }),
};
// torso loft: rings of a squarish 14-gon, y up; front is +z, character's left is +x
const RS = 14;
const RINGS = [ // y, half width, half depth (front), half depth (back), centre z
  [0.16, 0.07, 0.055, 0.06, -0.015],
  [0.15, 0.13, 0.07, 0.075, -0.012],
  [0.125, 0.172, 0.085, 0.085, -0.008],
  [0.085, 0.182, 0.105, 0.092, 0.0],
  [0.03, 0.172, 0.115, 0.095, 0.004],
  [-0.04, 0.152, 0.105, 0.09, 0.002],
  [-0.12, 0.132, 0.09, 0.085, -0.002],
  [-0.2, 0.128, 0.086, 0.086, -0.004],
  [-0.26, 0.136, 0.09, 0.09, -0.004],
];
function ringPt(r, i) {
  const [y, w, df, db, cz] = r, a = i / RS * Math.PI * 2;
  const s = Math.sin(a), c = Math.cos(a), k = 0.5;
  const x = Math.sign(s) * Math.pow(Math.abs(s), k) * w;
  const z = Math.sign(c) * Math.pow(Math.abs(c), k) * (c > 0 ? df : db) + cz;
  return V(x, y, z);
}
const torso = (() => {
  const pos = [], idx = [];
  RINGS.forEach(r => { for (let i = 0; i < RS; i++) { const p = ringPt(r, i); pos.push(p.x, p.y, p.z); } });
  for (let j = 0; j < RINGS.length - 1; j++) for (let i = 0; i < RS; i++) {
    const a = j * RS + i, b = j * RS + (i + 1) % RS, c = a + RS, d = b + RS;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, CM.vest);
})();
chest.add(torso);
// open ends seen from above / below
{ const neckHole = new THREE.Mesh(new THREE.CircleGeometry(0.07, 14), CM.vestIn); neckHole.rotation.x = -Math.PI / 2; neckHole.position.set(0, 0.158, -0.015); chest.add(neckHole); }
// neck stub inside the collar


chest.updateMatrixWorld(true);
const SURF = { mesh: torso, map: null }; // what plate() and onTorso() project onto; map(u, v) gives the ray origin
function onTorso(x, y, dir = V(0, 0, -1), from = null) {
  const o = from || (SURF.map ? SURF.map(x, y) : V(x, y, 0).addScaledVector(dir, -1));
  rc.set(o, dir.clone().normalize()); let h = rc.intersectObject(SURF.mesh, false)[0];
  if (!h && !from && !SURF.map) { const o2 = V(x * 4, y, 0.25); rc.set(o2, V(0, y, -0.02).sub(o2).normalize()); h = rc.intersectObject(SURF.mesh, false)[0]; }
  return h ? { p: h.point.clone(), n: h.face.normal.clone() } : null;
}

// thick faceted plate: outline (x,y) projected on the torso along `dir`, lifted by `lift`, with a bevelled wall of depth `th`
function plate(outline, { dir = V(0, 0, -1), lift = 0.012, th = 0.014, mat = CM.white, side = CM.whiteSide, bulge = null, center = null, peak = 0.016, ridge = null } = {}) {
  const hits = outline.map(([x, y]) => onTorso(x, y, dir));
  const top = [], bot = [];
  hits.forEach((h, i) => {
    const n = h.n.clone().lerp(dir.clone().negate(), 0.3).normalize();
    const p = h.p.clone().addScaledVector(n, lift);
    if (bulge) p.addScaledVector(n, bulge[i] || 0);
    top.push(p); bot.push(h.p.clone().addScaledVector(n, lift - th));
  });
  // big flat facets: a fan from a raised centre point to the outline, like a cut gem
  const o2 = outline.map(([x, y]) => new THREE.Vector2(x, y));
  const cw = THREE.ShapeUtils.isClockWise(o2);
  const cxy = center || o2.reduce((m, v) => m.add(v), new THREE.Vector2()).multiplyScalar(1 / o2.length);
  const ch = onTorso(cxy.x, cxy.y, dir); const C = ch.p.clone().addScaledVector(ch.n.clone().lerp(dir.clone().negate(), 0.3).normalize(), lift + peak);
  const face = [];
  const tri = (a, b, c) => { if (cw) face.push(a, c, b); else face.push(a, b, c); };
  if (!ridge) { for (let i = 0; i < top.length; i++) tri(C, top[i], top[(i + 1) % top.length]); }
  else {
    // a raised spine instead of a single peak: long shards get long clean facets
    const R2 = [], R = [];
    for (let k = 0; k <= 3; k++) { const v = ridge[0].clone().lerp(ridge[1], k / 3); R2.push(v); const h = onTorso(v.x, v.y, dir); R.push(h.p.clone().addScaledVector(h.n.clone().lerp(dir.clone().negate(), 0.3).normalize(), lift + peak)); }
    const near = o2.map(v => { let b = 0; R2.forEach((r, k) => { if (r.distanceTo(v) < R2[b].distanceTo(v)) b = k; }); return b; });
    for (let i = 0; i < top.length; i++) {
      const j = (i + 1) % top.length; let a = near[i]; const b = near[j];
      tri(R[a], top[i], top[j]);
      while (a !== b) { const n2 = a + Math.sign(b - a); tri(R[a], top[j], R[n2]); a = n2; }
    }
  }
  const g1 = new THREE.BufferGeometry().setFromPoints(face); g1.computeVertexNormals();
  const wall = [];
  for (let i = 0; i < top.length; i++) {
    const j = (i + 1) % top.length;
    wall.push(top[i], top[j], bot[i], top[j], bot[j], bot[i]);
  }
  const g2 = new THREE.BufferGeometry().setFromPoints(wall); g2.computeVertexNormals();
  const grp = new THREE.Group(); grp.add(new THREE.Mesh(g1, mat), new THREE.Mesh(g2, side));
  return { grp, top };
}

// main shard plate over the character's left chest and shoulder
const PLATE = [[0.012, 0.132], [0.09, 0.15], [0.165, 0.128], [0.186, 0.045], [0.174, -0.05], [0.1, -0.07], [0.03, -0.04], [-0.006, 0.03]];
const P1 = plate(PLATE, { lift: 0.012, th: 0.018, peak: 0.022, center: new THREE.Vector2(0.115, 0.045), bulge: [0, 0.006, 0.02, 0.026, 0.02, 0.006, 0, 0] }); chest.add(P1.grp);
// shoulder cap continuing the plate over the top (projected from above)
const CAP = [[0.07, 0.035], [0.155, 0.03], [0.17, -0.02], [0.15, -0.06], [0.09, -0.06]];
{
  const hits = CAP.map(([x, z]) => onTorso(0, 0, V(0, -1, 0), V(x, 1, z)));
  const top = hits.map(h => h.p.clone().addScaledVector(h.n, 0.014)), bot = hits.map(h => h.p.clone().addScaledVector(h.n, 0.0));
  const pts = [];
  for (let i = 1; i < top.length - 1; i++) pts.push(top[0], top[i + 1], top[i]);
  for (let i = 0; i < top.length; i++) { const j = (i + 1) % top.length; pts.push(top[i], top[j], bot[i], top[j], bot[j], bot[i]); }
  const g = new THREE.BufferGeometry().setFromPoints(pts); g.computeVertexNormals();
  chest.add(new THREE.Mesh(g, CM.white));
}


// sash: strap from the left shoulder across the chest to the right hip, over the plate
function ribbon(path2d, { w = 0.034, lift = 0.026, th = 0.007, mat = CM.white } = {}) {
  const c = path2d.map(([x, y]) => { const h = onTorso(x, y); return { p: h.p.clone().addScaledVector(h.n, lift), n: h.n }; });
  const pts = [];
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i], b = c[i + 1], t = b.p.clone().sub(a.p).normalize();
    const sa = new THREE.Vector3().crossVectors(a.n, t).normalize().multiplyScalar(w / 2), sb = new THREE.Vector3().crossVectors(b.n, t).normalize().multiplyScalar(w / 2);
    const A1 = a.p.clone().add(sa), A2 = a.p.clone().sub(sa), B1 = b.p.clone().add(sb), B2 = b.p.clone().sub(sb);
    const dA = a.n.clone().multiplyScalar(-th), dB = b.n.clone().multiplyScalar(-th);
    pts.push(A1, A2, B1, A2, B2, B1);                                   // face
    pts.push(A1, B1, A1.clone().add(dA), B1, B1.clone().add(dB), A1.clone().add(dA)); // edges
    pts.push(A2, A2.clone().add(dA), B2, B2, A2.clone().add(dA), B2.clone().add(dB));
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.material.side = THREE.DoubleSide; return { mesh: m, c };
}
const SASH = [[0.11, 0.02], [0.03, -0.045], [-0.05, -0.105], [-0.11, -0.155], [-0.135, -0.19]];
const sash = ribbon(SASH, { lift: 0.014 }); chest.add(sash.mesh);
// buckle on the sash: dark block with a cyan light bar
{
  const a = sash.c[2], b = sash.c[3], mid = a.p.clone().lerp(b.p, 0.5), t = b.p.clone().sub(a.p).normalize();
  const bk = new THREE.Group(); bk.position.copy(mid).addScaledVector(a.n, 0.008);
  bk.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(t, a.n).normalize(), t, a.n));
  bk.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.046, 0.012), CM.grey));
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.03, 0.004), M.glow); bar.position.z = 0.007; bk.add(bar);
  const hl = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.038, 0.002), M.halo); hl.position.z = 0.0095; bk.add(hl);
  chest.add(bk);
}

// back: wide white yoke under the collar, like the hood shape on the sheet's back view
const BACK = [[-0.12, 0.142], [0.12, 0.142], [0.15, 0.07], [0.05, 0.0], [-0.05, 0.0], [-0.15, 0.07]];
const PB = plate(BACK, { dir: V(0, 0, 1), lift: 0.01, th: 0.014, peak: 0.018, center: new THREE.Vector2(0, 0.08) }); chest.add(PB.grp);
// decals on the plate: "///" and a cyan light strip along the shoulder edge
function onPlate(x, y) { rc.set(V(x, y, 1), V(0, 0, -1)); const h = rc.intersectObject(P1.grp, true)[0]; return h; }
function decal(x, y, w, h, angle, mat, dz = 0.0012) {
  const hit = onPlate(x, y); if (!hit) return;
  const n = hit.face.normal.clone(); if (n.z < 0) n.negate();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.copy(hit.point).addScaledVector(n, dz);
  m.quaternion.setFromUnitVectors(V(0, 0, 1), n); m.rotateZ(angle);
  chest.add(m); return m;
}
for (let i = 0; i < 3; i++) decal(0.072 + i * 0.016, 0.09, 0.008, 0.034, -0.45, CM.ink);
decal(0.15, 0.065, 0.014, 0.08, 0.55, CM.ink, 0.0012);
decal(0.15, 0.065, 0.006, 0.068, 0.55, M.glow, 0.0018);


// centre seam / zip down the black front
{
  const a = onTorso(-0.004, 0.135), b = onTorso(-0.004, -0.25);
  const z = new THREE.Mesh(new THREE.BoxGeometry(0.006, a.p.y - b.p.y, 0.004), CM.grey); z.position.set(-0.004, (a.p.y + b.p.y) / 2, Math.max(a.p.z, b.p.z) + 0.001); chest.add(z);
}

// high stand collar: open at the front, white outside, black inside, slanted top that rises toward the front flaps
{
  const n = 18, gap = 0.075, pos = [], posIn = [];
  const R = (a) => [0.075 + 0.006 * Math.cos(a), 0.072 + 0.004 * Math.cos(a)];
  const H = (a) => 0.1 + 0.025 * Math.pow(Math.max(0, Math.cos(a)), 2); // taller at the front
  const outer = [], inner = [];
  for (let i = 0; i <= n; i++) {
    const a = gap * Math.PI + (i / n) * (2 - 2 * gap) * Math.PI; // from front-left round the back to front-right
    const [rx, rz] = R(a), flare = 1 + 0.5 * Math.pow(Math.max(0, Math.cos(a)), 3);
    const base = V(Math.sin(a) * rx, 0.135, Math.cos(a) * rz - 0.012);
    const topP = V(Math.sin(a) * rx * flare * 1.08, 0.135 + H(a), Math.cos(a) * rz * flare * 1.05 - 0.012);
    outer.push([base, topP]);
    inner.push([base.clone().multiplyScalar(1).setX(base.x * 0.82).setZ((base.z + 0.012) * 0.82 - 0.012), topP.clone().setX(topP.x * 0.86).setZ((topP.z + 0.012) * 0.86 - 0.012)]);
  }
  const o = [], q = [], rimP = [];
  for (let i = 0; i < n; i++) {
    const [a0, a1] = outer[i], [b0, b1] = outer[i + 1];
    o.push(a0, b0, a1, b0, b1, a1);
    const [c0, c1] = inner[i], [d0, d1] = inner[i + 1];
    q.push(c0, c1, d0, d0, c1, d1);
    rimP.push(a1, b1, c1, b1, d1, c1);
  }
  // front edges of the opening
  for (const i of [0, n]) { const [a0, a1] = outer[i], [c0, c1] = inner[i]; rimP.push(a0, a1, c0, a1, c1, c0); }
  const mk = (pts, mat) => { const g = new THREE.BufferGeometry().setFromPoints(pts); g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); chest.add(m); return m; };
  const oc = mk(o, CM.white); oc.material = CM.white.clone(); oc.material.side = THREE.DoubleSide;
  mk(q, CM.vestIn); const rm = mk(rimP, CM.whiteSide); rm.material = CM.whiteSide.clone(); rm.material.side = THREE.DoubleSide;
}

// ------------------------------------------------------------------ shared tools for hard-surface parts
// panels are scaled copies of a base shell, trimmed by flat planes: straight graphic edges like the sheet
function clipGeo(geo, planes) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position;
  let tris = [];
  for (let i = 0; i < p.count; i += 3) tris.push([V(p.getX(i), p.getY(i), p.getZ(i)), V(p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)), V(p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2))]);
  for (const pl of planes) {
    const next = [];
    for (const t of tris) {
      const out = [];
      for (let i = 0; i < 3; i++) {
        const a = t[i], b = t[(i + 1) % 3], da = pl.distanceToPoint(a), db = pl.distanceToPoint(b);
        if (da >= 0) out.push(a);
        if ((da >= 0) !== (db >= 0)) out.push(a.clone().lerp(b, da / (da - db)));
      }
      for (let i = 1; i < out.length - 1; i++) next.push([out[0], out[i], out[i + 1]]);
    }
    tris = next;
  }
  const r = new THREE.BufferGeometry().setFromPoints(tris.flat()); r.computeVertexNormals(); return r;
}
// plane containing the side-view line (z1,y1)-(z2,y2), parallel to x; keeps the side holding (kz,ky)
function cutZY(z1, y1, z2, y2, kz, ky) {
  const n = V(0, -(z2 - z1), (y2 - y1)).normalize(), pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, V(0, y1, z1));
  if (pl.distanceToPoint(V(0, ky, kz)) < 0) pl.negate(); return pl;
}
function cutXY(x1, y1, x2, y2, kx, ky) {
  const n = V(-(y2 - y1), (x2 - x1), 0).normalize(), pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, V(x1, y1, 0));
  if (pl.distanceToPoint(V(kx, ky, 0)) < 0) pl.negate(); return pl;
}
const cutY = (y, keepAbove) => new THREE.Plane(V(0, keepAbove ? 1 : -1, 0), keepAbove ? -y : y);
const cutX = (x, keepAbove) => new THREE.Plane(V(keepAbove ? 1 : -1, 0, 0), keepAbove ? -x : x);
const cutZ = (z, keepAbove) => new THREE.Plane(V(0, 0, keepAbove ? 1 : -1), keepAbove ? -z : z);
function scaled(geo, s, c) { const g = geo.clone(); g.translate(-c.x, -c.y, -c.z); g.scale(s.x, s.y, s.z); g.translate(c.x, c.y, c.z); return g; }
const mirrorX = pts => pts.flatMap(([x, y, z]) => x === 0 ? [V(0, y, z)] : [V(x, y, z), V(-x, y, z)]);
const PANEL = new THREE.MeshStandardMaterial({ color: '#dcdbe2', roughness: 0.46, metalness: 0.05, flatShading: true });
const DARKP = new THREE.MeshStandardMaterial({ color: '#2a2c33', roughness: 0.45, metalness: 0.2, flatShading: true });
const BASEK = new THREE.MeshStandardMaterial({ color: '#16171c', roughness: 0.6, metalness: 0.08, flatShading: true });
function glowBar(parent, a, b, w, n) { // a cyan bar from a to b lying on a surface with normal n, set in a dark slot
  const len = a.distanceTo(b), mid = a.clone().lerp(b, 0.5), up = b.clone().sub(a).normalize(), side = new THREE.Vector3().crossVectors(up, n).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, new THREE.Vector3().crossVectors(side, up)));
  const back = new THREE.Mesh(new THREE.BoxGeometry(w * 2.2, len + w * 1.2, 0.003), CM.ink), bar = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.004), M.glow);
  for (const m of [back, bar]) { m.position.copy(mid).addScaledVector(n, 0.0015); m.quaternion.copy(q); parent.add(m); }
}
function hitSide(mesh, y, z, sx = 1) { rc.set(V(sx, y, z), V(-sx, 0, 0)); const h = rc.intersectObject(mesh, false)[0]; return h && { p: h.point.clone(), n: h.face.normal.clone() }; }

// ------------------------------------------------------------------ shin guard: chunky white greave over a black calf, faceted knee, cyan side line
const shin = new THREE.Group();
// character's left leg; +x is the outer side, front is +z. knee at y = 0, ankle at y = -0.42
function loft(rings, n, mat, k = 0.6) {
  const pos = [], idx = [];
  for (const [y, w, df, db, cz] of rings) for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
    pos.push(Math.sign(s) * Math.pow(Math.abs(s), k) * w, y, Math.sign(c) * Math.pow(Math.abs(c), k) * (c > 0 ? df : db) + cz);
  }
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = j * n + (i + 1) % n, c = a + n, d = b + n; idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
const calf = loft([
  [0.17, 0.08, 0.08, 0.08, 0], [0.06, 0.072, 0.072, 0.07, 0], [0.0, 0.068, 0.068, 0.066, 0.004],
  [-0.08, 0.07, 0.062, 0.078, -0.004], [-0.18, 0.064, 0.058, 0.072, -0.006], [-0.29, 0.05, 0.05, 0.055, -0.004],
  [-0.38, 0.042, 0.044, 0.044, -0.002], [-0.45, 0.044, 0.048, 0.046, 0],
], 10, BASEK, 0.55);
shin.add(calf);
// the greave: the calf shell blown up, trimmed to the front; split by a black gap on the outer side like the sheet
{
  // front plate: a hull with a vertical ridge, wide under the knee and tapering to the ankle
  const front = new ConvexGeometry([
    [-0.074, -0.042, 0.035], [-0.012, -0.034, 0.104], [0.036, -0.05, 0.08], [-0.06, -0.05, -0.005], [0.03, -0.055, 0.0],
    [-0.07, -0.15, 0.03], [-0.008, -0.15, 0.094], [0.028, -0.15, 0.072],
    [-0.046, -0.312, 0.03], [-0.004, -0.312, 0.07], [0.016, -0.312, 0.058], [-0.04, -0.3, 0.0], [0.012, -0.3, 0.0],
  ].map(p => V(...p)));
  shin.add(new THREE.Mesh(front, PANEL));
  // outer panel behind a black gap
  const outer = new ConvexGeometry([
    [0.05, -0.075, 0.068], [0.08, -0.075, 0.022], [0.082, -0.08, -0.04], [0.04, -0.08, -0.03],
    [0.04, -0.29, 0.052], [0.058, -0.29, 0.004], [0.058, -0.285, -0.03], [0.03, -0.285, -0.02],
  ].map(p => V(...p)));
  shin.add(new THREE.Mesh(outer, PANEL));
  // ankle guard below a black strap: wider again, cut flat on top and slanted at the bottom
  const ankle = new ConvexGeometry([
    [-0.05, -0.338, 0.036], [0.0, -0.338, 0.07], [0.045, -0.338, 0.04], [-0.05, -0.338, -0.025], [0.05, -0.338, -0.025],
    [-0.058, -0.44, 0.04], [0.0, -0.44, 0.08], [0.054, -0.44, 0.045], [-0.058, -0.445, -0.03], [0.058, -0.445, -0.03], [0.0, -0.4, 0.084],
  ].map(p => V(...p)));
  shin.add(new THREE.Mesh(ankle, PANEL));
  const strap = clipGeo(scaled(calf.geometry, V(1.16, 1, 1.22), V(0, 0, 0)), [cutY(-0.317, false), cutY(-0.338, true), cutZ(-0.02, true)]);
  shin.add(new THREE.Mesh(strap, DARKP));
}
// knee: a chunky faceted cap, dark grey, with a white top shard
{
  const cap = new THREE.Mesh(new ConvexGeometry(mirrorX([[0.066, 0.06, 0.055], [0.0, 0.085, 0.08], [0.08, 0.0, 0.06], [0.0, 0.005, 0.112], [0.056, -0.05, 0.066], [0.0, -0.058, 0.084], [0.078, 0.05, 0.0], [0.078, -0.04, 0.0]])), DARKP);
  shin.add(cap);
  const shard = new THREE.Mesh(clipGeo(scaled(cap.geometry, V(1.06, 1.06, 1.06), V(0, 0.01, 0.03)), [cutY(0.028, true), cutZ(0.03, true)]), PANEL);

}
// cyan line down the outer side panel, and a tick on the knee
shin.updateMatrixWorld(true);
{
  const pick = (y, z) => { rc.set(V(1, y, z), V(-1, 0, 0)); return rc.intersectObjects(shin.children, false)[0]; };
  const a = pick(-0.1, -0.012), b = pick(-0.28, -0.012);
  if (a && b) glowBar(shin, a.point, b.point, 0.004, a.face.normal.clone());
  const k = pick(0.02, 0.02), k2 = pick(-0.02, 0.03);
  if (k && k2) glowBar(shin, k.point, k2.point, 0.004, k.face.normal.clone());
}

// ------------------------------------------------------------------ sneaker: faceted high-top; white vamp + tongue, dark strap, white heel block, glowing sole
const shoe = new THREE.Group(); shoe.scale.x = 1.15;
// side view: toe is +z, heel -z. sole 0..0.04, collar top ~0.215
const TOE = new ConvexGeometry(mirrorX([
  [0.06, 0.036, 0.02], [0.06, 0.036, 0.06], [0.055, 0.036, 0.13], [0.042, 0.036, 0.175], [0.014, 0.036, 0.192],
  [0.052, 0.108, 0.03], [0.05, 0.108, 0.1], [0.044, 0.1, 0.145], [0.03, 0.09, 0.172], [0.01, 0.088, 0.186], [0.034, 0.064, 0.184], [0.012, 0.06, 0.194],
]));
const ANK = new ConvexGeometry(mirrorX([
  [0.05, 0.036, -0.08], [0.058, 0.036, -0.02], [0.06, 0.036, 0.1],
  [0.05, 0.112, 0.105], [0.048, 0.155, 0.088], [0.042, 0.228, 0.042], [0.045, 0.236, -0.01], [0.043, 0.232, -0.06], [0.046, 0.18, -0.088], [0.05, 0.08, -0.09],
]));
const UPPER = mergeGeometries([TOE.toNonIndexed(), ANK.toNonIndexed()]);
const upper = new THREE.Mesh(UPPER, BASEK); shoe.add(upper);
const UC = V(0, 0.11, 0.04);
const lay = (s, planes, mat) => { for (const G of [TOE, ANK]) shoe.add(new THREE.Mesh(clipGeo(scaled(G, V(s, s * 0.985, s * 0.99), UC), planes), mat)); };
// strap: from behind the tongue at the top, down and forward to the midfoot
const strapF = [0.02, 0.236, 0.125, 0.036], strapB = [-0.024, 0.236, 0.075, 0.036];
const front = (k) => cutZY(strapF[0], strapF[1], strapF[2], strapF[3], 0.2, 0.2);
const behind = (k) => cutZY(strapB[0], strapB[1], strapB[2], strapB[3], -0.2, 0.2);
lay(1.05, [front(), cutZY(0.21, 0.08, 0.05, 0.106, 0.1, 0.3)], PANEL);                                         // white toe, vamp and tongue above a black mudguard
lay(1.03, [front().clone().negate(), behind().clone().negate()], DARKP);                                       // dark strap band
lay(1.06, [behind(), cutY(0.112, false), cutZY(-0.01, 0.112, 0.05, 0.036, -0.2, 0.05)], PANEL);              // white heel block
lay(1.055, [behind(), cutY(0.19, true)], PANEL);                                                             // white collar top at the back
// lace ribs on the vamp
{
  for (let i = 0; i < 3; i++) {
    const z = 0.07 + i * 0.022; rc.set(V(0, 1, z), V(0, -1, 0)); const h = rc.intersectObjects(shoe.children, false)[0]; if (!h) continue;
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.003, 0.004), CM.ink); r.position.copy(h.point).addScaledVector(h.face.normal, 0.0015);
    r.quaternion.setFromUnitVectors(V(0, 1, 0), h.face.normal); shoe.add(r);
  }
}
// sole: glowing cyan outsole with toe spring, thin white midsole on top
const FOOTW = [[-0.094, 0.05, 0], [-0.05, 0.062, 0], [0.06, 0.067, 0], [0.13, 0.062, 0.006], [0.178, 0.047, 0.016], [0.2, 0.02, 0.028]];
const soleHull = (grow, y0, y1) => new ConvexGeometry(FOOTW.flatMap(([z, w, lift]) => mirrorX([[w * grow, y0 + lift, z * grow + (z > 0 ? 0 : 0)], [w * grow, y1 + lift * 1.4, z * grow]])));
shoe.add(new THREE.Mesh(soleHull(1.0, 0.0, 0.03), M.glow));
shoe.add(new THREE.Mesh(soleHull(1.07, -0.003, 0.034), M.halo));
shoe.add(new THREE.Mesh(soleHull(1.015, 0.028, 0.039), PANEL));
// cyan flash at the back of the collar, both sides
shoe.updateMatrixWorld(true);
for (const sx of [1, -1]) {
  const a = hitSide(upper, 0.13, -0.072, sx), b = hitSide(upper, 0.18, -0.06, sx);
  if (a && b) glowBar(shoe, a.p.addScaledVector(a.n, 0.004), b.p.addScaledVector(b.n, 0.004), 0.006, a.n);
}
// ankle going up into the trouser
{ const a = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.1, 10), BASEK); a.position.set(0, 0.27, -0.015); shoe.add(a); }

export { head, hair, chest, shin, shoe, M, CM, CYAN, ConvexGeometry, clipGeo, mirrorX, PANEL, DARKP, BASEK, glowBar };
