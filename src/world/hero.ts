import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as P from "./cyberParts.js";

// The explorer: the cyber suit from the character sheet (black helmet with a cyan visor line,
// white shard hair, faceted white armour over a black suit, glowing soles, sword on the back).
// Parts were developed one at a time in the Part Lab (src/world/cyberParts.js) and are fitted here
// onto a small jointed rig so he can walk, run, jump, sit, wave and call.
// Feet are at y = 0, he faces +z, about 1.75 m tall.

// colors: kept compatible with the old figure. Each player gets their own accent glow from `tee`
// (or `band` when `tee` is too dark); you are cyan.
const C = { tee: 0x3ef0ee, band: 0x3ef0ee, skin: 0, pants: 0, shoe: 0, sole: 0, hair: 0, ink: 0x0b0c10 };

// ---- outlines: an inked back-face shell pushed out along smooth normals, constant width on screen
const INK = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: { color: { value: new THREE.Color(C.ink) } },
  vertexShader: `void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    mv.xyz += n * (0.0022 + 0.0016 * clamp(-mv.z, 0.0, 12.0));
    gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0); }`,
});
const inkCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function inkGeo(g: THREE.BufferGeometry) {
  let o = inkCache.get(g);
  if (!o) {
    const b = new THREE.BufferGeometry();
    b.setAttribute("position", g.attributes.position);
    if (g.index) b.setIndex(g.index);
    o = mergeVertices(b, 1e-4);
    o.computeVertexNormals();
    inkCache.set(g, o);
  }
  return o;
}
function addInk(root: THREE.Object3D) {
  const list: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.ink || m.children.some((c) => c.userData.ink)) return;
    const mat = m.material as THREE.Material;
    if (mat === P.M.glow || mat === P.M.halo || mat === P.CM.ink || (m.geometry as THREE.BufferGeometry).type === "PlaneGeometry") return;
    if (mat.transparent) return;
    list.push(m);
  });
  for (const m of list) { const s = new THREE.Mesh(inkGeo(m.geometry), INK); s.userData.ink = true; s.raycast = () => {}; m.add(s); }
}

// ---- fewer draw calls: merge every static mesh under a joint into one mesh per material
function bake(joint: THREE.Object3D, joints: Set<THREE.Object3D>) {
  joint.updateMatrixWorld(true);
  const inv = joint.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const found: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (joints.has(c)) continue;
      const m = c as THREE.Mesh;
      if (m.isMesh && !(m.material as THREE.Material).transparent || (m.isMesh && m.material === P.M.halo)) found.push(m);
      walk(c);
    }
  };
  walk(joint);
  for (const m of found) {
    const mat = m.material as THREE.Material;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    const keep = (mat as THREE.MeshStandardMaterial).vertexColors ? ["position", "normal", "color"] : ["position", "normal"];
    for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g = g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(g);
  }
  for (const m of found) m.removeFromParent();
  const strip = (o: THREE.Object3D) => { for (const c of [...o.children]) { if (joints.has(c)) continue; strip(c); if (!(c as THREE.Mesh).isMesh && c.children.length === 0) c.removeFromParent(); } };
  strip(joint);
  for (const [mat, gs] of byMat) {
    const merged = mergeGeometries(gs);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    if (mat === INK) mesh.raycast = () => {};
    joint.add(mesh);
  }
}

// ---- mirrored copy of a part (left leg parts -> right leg): flip x and the triangle winding
function mirrored(src: THREE.Object3D) {
  const c = src.clone(true);
  c.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.scale(-1, 1, 1);
    if (g.index) { const ix = g.index.array as Uint16Array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
    else for (const key of Object.keys(g.attributes)) {
      const at = g.attributes[key], n = at.itemSize, arr = at.array as Float32Array;
      for (let i = 0; i < at.count; i += 3) for (let k = 0; k < n; k++) { const t = arr[(i + 1) * n + k]; arr[(i + 1) * n + k] = arr[(i + 2) * n + k]; arr[(i + 2) * n + k] = t; }
    }
    g.computeVertexNormals();
    m.geometry = g;
    m.position.x *= -1;
    m.quaternion.set(m.quaternion.x, -m.quaternion.y, -m.quaternion.z, m.quaternion.w);
  });
  return c;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hull = (pts: number[][], s = 1) => new P.ConvexGeometry(pts.map(([x, y, z]) => V(x * s, y, z)));
const SUIT = P.BASEK, WHITE = P.PANEL, DARK = P.DARKP;

// ---- templates built once
let T: null | { head: THREE.Group; torso: THREE.Group; shinL: THREE.Object3D; shinR: THREE.Object3D; shoeL: THREE.Object3D; shoeR: THREE.Object3D } = null;
function templates() {
  if (T) return T;
  const head = P.head.clone(true);
  const torso = P.chest.clone(true);
  // the lower leg ends inside the sneaker: drop the ankle guard and strap
  const shinL = P.shin.clone(true);
  const drop: THREE.Object3D[] = [];
  shinL.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.geometry.computeBoundingBox(); if (m.geometry.boundingBox!.max.y < -0.3) drop.push(m); });
  drop.forEach((m) => m.parent!.remove(m));
  const shoeL = P.shoe.clone(true);
  for (const g of [head, torso, shinL, shoeL]) addInk(g);
  const shinR = mirrored(shinL), shoeR = mirrored(shoeL);
  T = { head, torso, shinL, shinR, shoeL, shoeR };
  return T;
}

const glowMats = new Map<number, [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial]>();
function accentMats(hex: number) {
  let m = glowMats.get(hex);
  if (!m) {
    if (hex === P.CYAN.getHex()) m = [P.M.glow, P.M.halo];
    else { const g = P.M.glow.clone(); g.color.setHex(hex); const h = P.M.halo.clone(); h.color.setHex(hex); m = [g, h]; }
    glowMats.set(hex, m);
  }
  return m;
}

export class Hero {
  root = new THREE.Group();
  private body = new THREE.Group();
  private hips: THREE.Group[] = [];
  private knees: THREE.Group[] = [];
  private shoulders: THREE.Group[] = [];
  private elbows: THREE.Group[] = [];
  private head = new THREE.Group();
  private tails: THREE.Object3D[] = [];
  private phase = 0;
  private air = 0;
  private seat = 0; // 0 standing .. 1 sitting
  private waveT = -1;
  private callT = -1;

  constructor(colors: Partial<typeof C> = {}) {
    const pal = { ...C, ...colors };
    const lum = (h: number) => ((h >> 16) & 255) * 0.3 + ((h >> 8) & 255) * 0.59 + (h & 255) * 0.11;
    const accent = colors.tee === undefined ? C.tee : lum(pal.tee) > 70 ? pal.tee : lum(pal.band) > 70 ? pal.band : C.tee;
    const [glow, halo] = accentMats(accent);
    const t = templates();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m;
    };

    this.root.add(this.body);
    this.body.position.y = 0.95;

    // torso (the chest plate part), pelvis and belt
    const torso = t.torso.clone(true); torso.position.y = 0.385; this.body.add(torso);
    add(hull([[0.13, 0.13, 0.085], [0.13, 0.13, -0.08], [0.12, -0.02, 0.08], [0.12, -0.02, -0.075], [0.05, -0.1, 0.06], [0.05, -0.1, -0.06], [-0.13, 0.13, 0.085], [-0.13, 0.13, -0.08], [-0.12, -0.02, 0.08], [-0.12, -0.02, -0.075], [-0.05, -0.1, 0.06], [-0.05, -0.1, -0.06]]), SUIT, this.body);
    add(hull([[0.142, 0.135, 0.098], [0.142, 0.135, -0.092], [0.142, 0.095, 0.098], [0.142, 0.095, -0.092], [-0.142, 0.135, 0.098], [-0.142, 0.135, -0.092], [-0.142, 0.095, 0.098], [-0.142, 0.095, -0.092]]), DARK, this.body);
    for (const [x, w] of [[-0.03, 0.06], [0.07, 0.035], [-0.11, 0.03]]) {
      add(new THREE.BoxGeometry(w, 0.05, 0.03), SUIT, this.body, x, 0.115, 0.102);
    }
    add(new THREE.BoxGeometry(0.006, 0.03, 0.004), glow, this.body, -0.03, 0.115, 0.119);
    add(new THREE.BoxGeometry(0.004, 0.024, 0.004), glow, this.body, 0.07, 0.115, 0.119);

    // coat tails from the belt: long white flap on the right front, black flap with white stripes on the left, two at the back
    const tail = (pts: number[][], mat: THREE.Material, x: number, z: number, front: boolean) => {
      const g = new THREE.Group(); g.position.set(x, 0.1, z); g.userData.front = front; this.body.add(g);
      add(hull(pts), mat, g); this.tails.push(g); return g;
    };
    tail([[-0.07, 0, 0], [0.07, 0, 0], [-0.08, -0.5, 0.02], [0.05, -0.44, 0.02], [-0.07, 0, 0.018], [0.07, 0, 0.018], [-0.08, -0.5, 0.036], [0.05, -0.44, 0.036]], WHITE, -0.075, 0.09, true);
    const lf = tail([[-0.065, 0, 0], [0.065, 0, 0], [-0.04, -0.47, 0.02], [0.075, -0.52, 0.02], [-0.065, 0, 0.016], [0.065, 0, 0.016], [-0.04, -0.47, 0.034], [0.075, -0.52, 0.034]], SUIT, 0.075, 0.09, true);
    for (let i = 0; i < 3; i++) { const s = add(new THREE.BoxGeometry(0.06, 0.009, 0.004), WHITE, lf, 0.02, -0.36 - i * 0.025 - 0.0, 0.037 + 0.0005 * i); s.rotation.z = 0.35; }
    tail([[-0.08, 0, 0], [0.08, 0, 0], [-0.07, -0.42, -0.02], [0.08, -0.46, -0.02], [-0.08, 0, -0.016], [0.08, 0, -0.016], [-0.07, -0.42, -0.034], [0.08, -0.46, -0.034]], SUIT, -0.07, -0.085, false);
    tail([[-0.08, 0, 0], [0.08, 0, 0], [-0.08, -0.34, -0.02], [0.07, -0.3, -0.02], [-0.08, 0, -0.016], [0.08, 0, -0.016], [-0.08, -0.34, -0.034], [0.07, -0.3, -0.034]], WHITE, 0.075, -0.085, false);

    // sword on the back: hilt over the left shoulder
    const sword = new THREE.Group(); sword.position.set(0.03, 0.36, -0.13); sword.rotation.z = -0.32; this.body.add(sword);
    add(new THREE.BoxGeometry(0.035, 0.62, 0.012), DARK, sword, 0, -0.08, 0);
    add(new THREE.BoxGeometry(0.05, 0.6, 0.026), SUIT, sword, 0, -0.1, -0.008);
    add(new THREE.BoxGeometry(0.075, 0.018, 0.034), DARK, sword, 0, 0.22, -0.006);
    add(new THREE.BoxGeometry(0.026, 0.17, 0.026), SUIT, sword, 0, 0.32, -0.006);

    // head: helmet, visor line, headphones and hair
    this.head.position.set(0, 0.715, 0.005);
    this.body.add(this.head);
    this.head.add(t.head.clone(true));

    // arms: pauldron -> upper arm -> elbow -> forearm with white guard and cyan strip -> glove
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.2, 0.49, -0.005);
      this.body.add(sh);
      add(hull([[0.0, 0.07, 0.075], [0.0, 0.07, -0.075], [0.09, 0.05, 0.07], [0.09, 0.05, -0.07], [0.115, -0.05, 0.065], [0.115, -0.05, -0.065], [0.03, -0.09, 0.07], [0.03, -0.09, -0.07]], s), SUIT, sh);
      add(hull([[0.02, 0.085, 0.07], [0.02, 0.085, -0.06], [0.1, 0.065, 0.068], [0.1, 0.065, -0.06], [0.128, -0.02, 0.062], [0.128, -0.02, -0.056], [0.06, 0.02, 0.078], [0.07, -0.0, -0.066]], s), WHITE, sh);
      add(new THREE.CylinderGeometry(0.044, 0.04, 0.26, 7).translate(0, -0.15, 0), SUIT, sh, s * 0.01, 0, 0);
      const el = new THREE.Group();
      el.position.set(s * 0.01, -0.29, 0);
      sh.add(el);
      add(new THREE.CylinderGeometry(0.04, 0.034, 0.25, 7).translate(0, -0.125, 0), SUIT, el);
      add(hull([[0.035, -0.03, 0.038], [0.035, -0.03, -0.038], [0.052, -0.06, 0.03], [0.052, -0.06, -0.03], [0.046, -0.2, 0.03], [0.046, -0.2, -0.026], [0.02, -0.2, 0.04], [0.02, -0.03, 0.048], [0.0, -0.21, 0.0], [0.0, -0.03, 0.0]], s), WHITE, el);
      const bar = add(new THREE.BoxGeometry(0.004, 0.09, 0.006), glow, el, s * 0.054, -0.13, 0.0);
      bar.rotation.z = s * -0.03;
      add(hull([[0.035, 0, 0.03], [0.035, 0, -0.03], [-0.035, 0, 0.03], [-0.035, 0, -0.03], [0.03, -0.1, 0.022], [0.03, -0.1, -0.02], [-0.025, -0.1, 0.022], [-0.025, -0.1, -0.02], [0.0, -0.115, 0.0]], s), SUIT, el, 0, -0.25, 0);
      this.shoulders.push(sh);
      this.elbows.push(el);
    }

    // legs: hip -> black thigh -> knee -> shin guard part -> sneaker part
    for (const s of [-1, 1]) {
      const hp = new THREE.Group();
      hp.position.set(s * 0.095, -0.02, 0);
      this.body.add(hp);
      add(hull([[0.075, 0.04, 0.08], [0.075, 0.04, -0.08], [-0.075, 0.04, 0.08], [-0.075, 0.04, -0.08], [0.065, -0.4, 0.062], [0.065, -0.4, -0.062], [-0.065, -0.4, 0.062], [-0.065, -0.4, -0.062], [0.0, -0.2, 0.09], [0.0, -0.2, -0.088], [0.08, -0.18, 0.0], [-0.075, -0.18, 0.0]]), SUIT, hp);
      const kn = new THREE.Group();
      kn.position.y = -0.43;
      hp.add(kn);
      kn.add((s > 0 ? t.shinL : t.shinR).clone(true));
      const sh = (s > 0 ? t.shoeL : t.shoeR).clone(true);
      sh.position.set(0, -0.52, -0.005);
      kn.add(sh);
      this.hips.push(hp);
      this.knees.push(kn);
    }
    addInk(this.body);

    // own accent colour on every glowing bit
    if (glow !== P.M.glow) this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.material === P.M.glow) m.material = glow; else if (m.material === P.M.halo) m.material = halo;
    });

    // merge each joint's pieces: a few draw calls per player instead of hundreds
    const joints = new Set<THREE.Object3D>([this.body, this.head, ...this.shoulders, ...this.elbows, ...this.hips, ...this.knees, ...this.tails]);
    for (const j of joints) bake(j, joints);

    // a soft dark blob under the feet so he sits on the ground
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(0,0,0,0.55)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    shadow.position.y = 0.03;
    this.root.add(shadow);
  }

  wave() {
    this.waveT = 0;
  }

  // the call: chin up, arms spread for a moment
  call() {
    this.callT = 0;
  }

  // speed in m/s (0 = standing), airborne while jumping or falling; call every frame
  animate(speed: number, dt: number, t: number, airborne = false, sitting = false) {
    this.air += ((airborne ? 1 : 0) - this.air) * Math.min(1, dt * 12);
    this.seat += ((sitting ? 1 : 0) - this.seat) * Math.min(1, dt * 8);
    const run = THREE.MathUtils.clamp(speed / 7, 0, 1);
    const walk = THREE.MathUtils.clamp(speed / 2, 0, 1);
    this.phase += dt * (speed > 0.05 ? 3.2 + speed * 1.15 : 0);
    const p = this.phase, sw = Math.sin(p);
    const stride = walk * (0.55 + run * 0.35);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1, ph = s * sw;
      this.hips[i].rotation.x = -ph * stride;
      this.knees[i].rotation.x = Math.max(0, Math.sin(p * 1 + (s > 0 ? 0 : Math.PI) - 1.2)) * stride * 1.6 + 0.05;
      this.shoulders[i].rotation.x = ph * stride * (0.9 + run * 0.4);
      this.shoulders[i].rotation.z = s * (0.12 + run * 0.08);
      this.elbows[i].rotation.x = -(0.25 + run * 1.1 + Math.max(0, ph) * stride * 0.4);
    }
    // bob, lean into a run, breathe when idle
    this.body.position.y = 0.95 + Math.abs(Math.cos(p)) * 0.05 * walk - 0.04 * run + (speed < 0.05 ? Math.sin(t * 2) * 0.006 : 0);
    this.body.rotation.x = run * 0.22 + walk * 0.04;
    this.body.rotation.y = sw * 0.08 * walk;
    this.head.rotation.x = -run * 0.15;
    // in the air: knees tucked, arms up and out
    const a = this.air;
    if (a > 0.01)
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        this.hips[i].rotation.x = THREE.MathUtils.lerp(this.hips[i].rotation.x, i === 0 ? -0.9 : -0.3, a);
        this.knees[i].rotation.x = THREE.MathUtils.lerp(this.knees[i].rotation.x, i === 0 ? 1.4 : 0.7, a);
        this.shoulders[i].rotation.x = THREE.MathUtils.lerp(this.shoulders[i].rotation.x, -0.6, a);
        this.shoulders[i].rotation.z = THREE.MathUtils.lerp(this.shoulders[i].rotation.z, s * 0.9, a);
      }
    // sitting on a bench: thighs forward, shins down, hands on the knees
    const st = this.seat;
    if (st > 0.01) {
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        this.hips[i].rotation.x = THREE.MathUtils.lerp(this.hips[i].rotation.x, -1.5, st);
        this.knees[i].rotation.x = THREE.MathUtils.lerp(this.knees[i].rotation.x, 1.5, st);
        this.shoulders[i].rotation.x = THREE.MathUtils.lerp(this.shoulders[i].rotation.x, -0.55, st);
        this.shoulders[i].rotation.z = THREE.MathUtils.lerp(this.shoulders[i].rotation.z, s * 0.12, st);
        this.elbows[i].rotation.x = THREE.MathUtils.lerp(this.elbows[i].rotation.x, -0.7, st);
      }
      this.body.position.y = THREE.MathUtils.lerp(this.body.position.y, 0.6 + Math.sin(t * 2) * 0.004, st);
      this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, -0.05, st);
      this.body.position.z = THREE.MathUtils.lerp(0, -0.12, st);
    } else this.body.position.z = 0;
    // the call: arms out and up, head back
    if (this.callT >= 0) {
      this.callT += dt;
      const k = Math.min(1, this.callT * 8, (1.1 - this.callT) * 6);
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        this.shoulders[i].rotation.z = THREE.MathUtils.lerp(this.shoulders[i].rotation.z, s * 1.9, k);
        this.shoulders[i].rotation.x = THREE.MathUtils.lerp(this.shoulders[i].rotation.x, -0.3, k);
        this.elbows[i].rotation.x = THREE.MathUtils.lerp(this.elbows[i].rotation.x, -0.2, k);
      }
      this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, -0.45, k);
      if (this.callT > 1.1) this.callT = -1;
    }
    // wave with the right hand for two seconds
    if (this.waveT >= 0) {
      this.waveT += dt;
      const k = Math.min(1, this.waveT * 5, (2 - this.waveT) * 5);
      this.shoulders[1].rotation.z = THREE.MathUtils.lerp(this.shoulders[1].rotation.z, -2.6, k);
      this.shoulders[1].rotation.x = THREE.MathUtils.lerp(this.shoulders[1].rotation.x, 0, k);
      this.elbows[1].rotation.x = 0;
      this.elbows[1].rotation.z = Math.sin(this.waveT * 12) * 0.5 * k;
      if (this.waveT > 2) { this.waveT = -1; this.elbows[1].rotation.z = 0; }
    }
    // coat tails: front flaps follow the thigh, back flaps trail behind; front flaps lie on the lap when sitting
    this.tails.forEach((tl, i) => {
      const hip = this.hips[tl.position.x < 0 ? 0 : 1].rotation.x, front = !!tl.userData.front;
      const flap = Math.sin(t * 9 + i) * 0.03 * run;
      const move = front ? Math.min(0, hip) * 0.9 + flap : Math.min(0.85, run * 0.45 + walk * 0.1 + Math.max(0, hip) * 0.5) + flap;
      tl.rotation.x = THREE.MathUtils.lerp(move, front ? -1.4 : 0.1, st);
    });
  }
}
