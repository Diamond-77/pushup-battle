import * as THREE from "three";

// A faceless anime-style push-up guy for the how-to-play demo.
// Built from simple toon-shaded parts with ink outlines, posed by hand every frame
// (no skeleton file): hands stay on the floor, the body is a straight plank that pivots
// on the toes, and the elbows are solved so the arms always reach the hands.
//
// Space: y is up, the phone (camera) is at +z, the head points at the phone.

export type Look = "normal" | "ghost" | "intruder";
export type Pose = {
  depth: number; // 0 = arms straight, 1 = chest at the floor
  x?: number; // slide sideways
  z?: number; // slide toward (+) or away from (-) the phone
  yaw?: number; // turn the whole body
  knees?: number; // 0 = proper plank, 1 = knees on the floor
  lift?: number; // 0 = on the floor, 1 = floating up (used when someone walks out)
};

// MediaPipe landmark ids we fake, so the real stickman drawing can be reused
export const LM = { nose: 0, ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24, lk: 25, rk: 26, la: 27, ra: 28 } as const;

const COLORS = {
  skin: 0xf3c9a4,
  tee: 0xf7f7f2,
  pants: 0x1a1b22,
  shoe: 0x2fd65a,
  sole: 0xf2f2f2,
  hair: 0x232a44,
  band: 0xe0313c,
  ink: 0x14100e,
};

let gradient: THREE.DataTexture | null = null;
export function toonGradient() {
  if (gradient) return gradient;
  const data = new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

const UP = new THREE.Vector3(0, 1, 0);

// the Arasaka emblem (same drawing as ClanLogo), for the headband
let logoTex: THREE.CanvasTexture | null = null;
function arasakaLogo() {
  if (logoTex) return logoTex;
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 104;
  const g = c.getContext("2d")!;
  g.scale(2, 2);
  g.lineJoin = "round";
  g.fillStyle = "#1b1a1f";
  g.strokeStyle = "#1b1a1f";
  g.lineWidth = 2.5;
  const hex = new Path2D("M24 1 46 13v26L24 51 2 39V13z");
  g.fill(hex);
  g.stroke(hex);
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.lineWidth = 1.5;
  g.stroke(new Path2D("M24 6 41 15.5v21L24 46 7 36.5v-21z"));
  const bolt = new Path2D("M27 9 14 29h9l-4 15 15-22h-9l4-13z");
  g.fillStyle = "#fff4e6";
  g.fill(bolt);
  logoTex = new THREE.CanvasTexture(c);
  logoTex.colorSpace = THREE.SRGBColorSpace;
  return logoTex;
}
const OUTLINE = 0.011; // ink line thickness in metres

type Part = { mesh: THREE.Mesh; ink: THREE.Mesh };

export class Figure {
  root = new THREE.Group();
  private body = new THREE.Group();
  private mats: THREE.Material[] = [];
  private inkMat: THREE.MeshBasicMaterial;
  private limbs: Record<string, Part> = {};
  private joints: Record<string, Part> = {};
  private head = new THREE.Group();
  private tails: THREE.Mesh[] = [];
  private tailBase: Float32Array[] = [];
  private pts: Record<number, THREE.Vector3> = {};
  private spikes: { m: THREE.Mesh; ink: THREE.Mesh; q: THREE.Quaternion; phase: number; amp: number }[] = [];
  private shirt!: THREE.Mesh;
  private shirtInk!: THREE.Mesh;
  private shirtBase!: Float32Array;
  readonly look: Look;

  constructor(look: Look = "normal") {
    this.look = look;
    this.root.add(this.body);
    const ghost = look !== "normal";
    this.inkMat = ghost
      ? new THREE.MeshBasicMaterial({ color: look === "ghost" ? 0x9bf0c8 : 0xff4b4b, side: THREE.BackSide, transparent: true, opacity: 0.9, depthWrite: false })
      : new THREE.MeshBasicMaterial({ color: COLORS.ink, side: THREE.BackSide });
    const mat = (color: number) => {
      const m = ghost
        ? new THREE.MeshBasicMaterial({ color: look === "ghost" ? 0x5fd6a0 : 0xc8282c, transparent: true, opacity: 0.32, depthWrite: true })
        : new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
      this.mats.push(m);
      return m;
    };
    const skin = mat(COLORS.skin), tee = mat(COLORS.tee), pants = mat(COLORS.pants), shoe = mat(COLORS.shoe);
    const hair = mat(COLORS.hair), band = mat(COLORS.band), sole = mat(COLORS.sole);

    // limbs: unit-height cylinders stretched between two points every frame
    const limb = (name: string, r: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 14, 1, true), m);
      const ink = new THREE.Mesh(new THREE.CylinderGeometry(r + OUTLINE, r + OUTLINE, 1, 14, 1, true), this.inkMat);
      this.prep(mesh, ink);
      this.limbs[name] = { mesh, ink };
    };
    const joint = (name: string, r: number, m: THREE.Material, sx = 1, sy = 1, sz = 1) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), m);
      const ink = new THREE.Mesh(new THREE.SphereGeometry(r + OUTLINE, 18, 12), this.inkMat);
      mesh.scale.set(sx, sy, sz);
      ink.scale.set(sx, sy, sz);
      this.prep(mesh, ink);
      this.joints[name] = { mesh, ink };
    };

    // torso: tee (upper) and pants (pelvis), flattened front to back
    limb("chest", 0.135, tee);
    limb("belly", 0.12, tee);
    limb("pelvis", 0.118, pants);
    joint("chestTop", 0.135, tee, 1.45, 1, 0.82);
    joint("chestLow", 0.125, tee, 1.3, 1, 0.8);
    joint("hipBall", 0.12, pants, 1.3, 1, 0.85);
    for (const s of ["l", "r"]) {
      joint(s + "Shoulder", 0.066, tee);
      limb(s + "Sleeve", 0.06, tee);
      limb(s + "Upper", 0.043, skin);
      joint(s + "Elbow", 0.043, skin);
      limb(s + "Fore", 0.038, skin);
      joint(s + "Hand", 0.042, skin, 1.15, 0.5, 1.15);
      for (let f = 0; f < 5; f++) limb(s + "Finger" + f, f === 0 ? 0.013 : 0.011, skin);
      limb(s + "Thigh", 0.07, pants);
      joint(s + "Knee", 0.06, pants);
      limb(s + "Shin", 0.052, pants);
      joint(s + "Ankle", 0.05, pants);
      limb(s + "Shoe", 0.05, shoe);
      joint(s + "Toe", 0.05, shoe, 1, 1, 1);
      joint(s + "Heel", 0.048, sole);
    }
    limb("neck", 0.045, skin);
    // the loose part of the tee: hangs toward the floor and ripples a little
    const loose = new THREE.CylinderGeometry(0.128, 0.134, 0.3, 20, 5, true);
    this.shirtBase = Float32Array.from(loose.attributes.position.array);
    this.shirt = new THREE.Mesh(loose, tee);
    this.shirtInk = new THREE.Mesh(loose, this.inkMat);
    this.shirtInk.scale.set(1.08, 1.0, 1.08);
    this.prep(this.shirt, this.shirtInk);

    // head: blank face, spiky anime hair, red headband with two tails
    const headR = 0.116;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(headR, 40, 28), skin);
    skull.scale.set(0.95, 1.05, 1);
    const skullInk = new THREE.Mesh(new THREE.SphereGeometry(headR + OUTLINE, 24, 18), this.inkMat);
    skullInk.scale.copy(skull.scale);
    this.head.add(skull, skullInk);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.07, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), hair);
    cap.rotation.x = -0.35;
    cap.position.set(0, 0.006, -0.01);
    this.head.add(cap);
    const spike = (len: number, r: number, pos: THREE.Vector3, dir: THREE.Vector3) => {
      const g = new THREE.ConeGeometry(r, len, 5);
      g.translate(0, len / 2, 0);
      const m = new THREE.Mesh(g, hair);
      const ink = new THREE.Mesh(g.clone().scale(1.18, 1.06, 1.18), this.inkMat);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
      for (const o of [m, ink]) {
        o.position.copy(pos);
        o.quaternion.copy(q);
        this.head.add(o);
      }
      this.spikes.push({ m, ink, q, phase: this.spikes.length * 1.7, amp: 0.1 + (len > 0.07 ? 0.08 : 0.04) });
    };
    // crown and back spikes
    const spikes: [number, number, number, number][] = [
      // [around-angle, up-angle, length, radius]
      [0, 1.25, 0.11, 0.045], [1.1, 0.95, 0.1, 0.045], [-1.1, 0.95, 0.1, 0.045], [2.2, 0.95, 0.09, 0.042], [-2.2, 0.95, 0.09, 0.042],
      [Math.PI, 1.05, 0.1, 0.045], [2.75, 0.85, 0.08, 0.04], [-2.75, 0.85, 0.08, 0.04], [1.8, 0.3, 0.09, 0.04], [-1.8, 0.3, 0.09, 0.04],
      [0.55, 1.1, 0.095, 0.042], [-0.55, 1.1, 0.095, 0.042],
    ];
    for (const [a, u, len, r] of spikes) {
      const d = new THREE.Vector3(Math.sin(a) * Math.cos(u), Math.sin(u), -Math.cos(a) * Math.cos(u));
      spike(len * 0.72, r * 0.9, d.clone().multiplyScalar(headR * 0.85), d.add(new THREE.Vector3(0, 0.2, -0.45)));
    }
    // bangs falling over the forehead, above the band
    for (const bx of [-0.07, -0.035, 0.035, 0.07]) {
      const pos = new THREE.Vector3(bx, 0.115, 0.03);
      spike(0.05, 0.024, pos, new THREE.Vector3(bx * 5, 0.9, 0.7));
    }
    // wide cloth headband, with the Arasaka emblem on the forehead
    const bandR = headR * 1.08, bandH = 0.058;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(bandR, bandR * 1.04, bandH, 36, 1, true), band);
    const ringInk = new THREE.Mesh(new THREE.CylinderGeometry(bandR + OUTLINE * 0.8, bandR * 1.04 + OUTLINE * 0.8, bandH + 0.008, 36, 1, true), this.inkMat);
    const bandG = new THREE.Group();
    bandG.rotation.x = 0.28;
    bandG.position.set(0, 0.022, -0.004);
    bandG.add(ring, ringInk);
    if (!ghost) {
      const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.046, 0.05), new THREE.MeshBasicMaterial({ map: arasakaLogo(), transparent: true }));
      logo.position.set(0, 0, bandR * 1.02 + 0.003);
      bandG.add(logo);
    }
    this.head.add(bandG);
    // a face with shape but no features drawn: jaw and ears
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.62, 18, 12), skin);
    jaw.scale.set(1.05, 0.8, 0.95);
    jaw.position.set(0, -headR * 0.5, headR * 0.28);
    const jawInk = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.62 + OUTLINE, 18, 12), this.inkMat);
    jawInk.scale.copy(jaw.scale);
    jawInk.position.copy(jaw.position);
    this.head.add(jaw, jawInk);
    for (const ex of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), skin);
      ear.scale.set(0.45, 1, 0.75);
      ear.position.set(ex * headR * 0.93, -0.008, -0.005);
      const earInk = new THREE.Mesh(new THREE.SphereGeometry(0.026 + OUTLINE * 0.8, 10, 8), this.inkMat);
      earInk.scale.copy(ear.scale);
      earInk.position.copy(ear.position);
      this.head.add(ear, earInk);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), band);
    knot.position.set(0, 0.012, -headR * 1.0);
    this.head.add(knot);
    for (const side of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.036, 0.24, 1, 8);
      g.translate(0, -0.12, 0);
      const t = new THREE.Mesh(g, ghost ? band : new THREE.MeshToonMaterial({ color: COLORS.band, gradientMap: toonGradient(), side: THREE.DoubleSide }));
      if (!ghost) this.mats.push(t.material as THREE.Material);
      t.position.copy(knot.position);
      t.rotation.set(1.0, side * 0.4, side * 0.3);
      this.head.add(t);
      this.tails.push(t);
      this.tailBase.push(Float32Array.from(g.attributes.position.array));
    }
    this.head.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = !ghost;
        if (ghost) o.renderOrder = 2;
      }
    });
    this.body.add(this.head);
    for (const k of Object.values(LM)) this.pts[k] = new THREE.Vector3();
    this.setPose({ depth: 0 });
  }

  private prep(mesh: THREE.Mesh, ink: THREE.Mesh) {
    const ghost = this.look !== "normal";
    mesh.castShadow = !ghost;
    if (ghost) mesh.renderOrder = ink.renderOrder = 2;
    this.body.add(mesh, ink);
  }

  setOpacity(o: number) {
    this.root.visible = o > 0.01;
    if (this.look === "normal") return;
    const base = this.look === "ghost" ? 0.22 : 0.45;
    for (const m of this.mats) (m as THREE.MeshBasicMaterial).opacity = base * o;
    this.inkMat.opacity = 0.9 * o;
  }

  private stretch(name: string, a: THREE.Vector3, b: THREE.Vector3) {
    const { mesh, ink } = this.limbs[name];
    const d = new THREE.Vector3().subVectors(b, a);
    const len = Math.max(0.001, d.length());
    const unit = d.clone().divideScalar(len);
    for (const o of [mesh, ink]) {
      o.position.copy(a).addScaledVector(d, 0.5);
      o.quaternion.setFromUnitVectors(UP, unit);
      o.scale.set(1, len, 1);
    }
  }
  private place(name: string, p: THREE.Vector3, q?: THREE.Quaternion) {
    const { mesh, ink } = this.joints[name];
    mesh.position.copy(p);
    ink.position.copy(p);
    if (q) {
      mesh.quaternion.copy(q);
      ink.quaternion.copy(q);
    }
  }

  // Two-bone reach: where the elbow goes so the arm joins shoulder and hand, bending toward `pole`.
  private elbow(s: THREE.Vector3, h: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3) {
    const d = new THREE.Vector3().subVectors(h, s);
    const dist = Math.min(d.length(), l1 + l2 - 1e-4);
    d.normalize();
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const perp = pole.clone().addScaledVector(d, -pole.dot(d)).normalize();
    return s.clone().addScaledVector(d, a).addScaledVector(perp, hgt);
  }

  setPose(p: Pose, time = 0) {
    const depth = THREE.MathUtils.clamp(p.depth, 0, 1);
    const knees = p.knees ?? 0;
    const lift = p.lift ?? 0;
    this.root.position.set(p.x ?? 0, lift * 0.25, p.z ?? 0);
    this.root.rotation.y = p.yaw ?? 0;

    // plank: toes on the floor far from the phone, shoulders over the hands
    const pivot = new THREE.Vector3(0, 0.1, -1.42); // ankle height
    const shY = THREE.MathUtils.lerp(0.53, 0.2, depth);
    const sh = new THREE.Vector3(0, shY, pivot.z + Math.sqrt(1.42 ** 2 - (shY - pivot.y) ** 2));
    const dir = new THREE.Vector3().subVectors(sh, pivot).normalize();
    let hipC = pivot.clone().addScaledVector(dir, 0.86);
    let kneeC = pivot.clone().addScaledVector(dir, 0.44);
    let ankC = pivot.clone();
    if (knees > 0) {
      // knees on the floor: hips sag, shins rise behind
      const kFloor = new THREE.Vector3(0, 0.07, -0.95);
      const kd = new THREE.Vector3().subVectors(sh, kFloor).normalize();
      hipC = hipC.lerp(kFloor.clone().addScaledVector(kd, 0.44), knees);
      kneeC = kneeC.lerp(kFloor, knees);
      ankC = ankC.lerp(new THREE.Vector3(0, 0.3, -1.32), knees);
    }
    const up = new THREE.Vector3().subVectors(sh, hipC).normalize(); // torso direction
    const belly = new THREE.Vector3(0, -up.z, up.y); // toward the floor

    // torso
    const chestTop = sh.clone().addScaledVector(up, -0.02).addScaledVector(belly, 0.02);
    const chestLow = hipC.clone().addScaledVector(up, 0.24).addScaledVector(belly, 0.015);
    const hipBall = hipC.clone().addScaledVector(up, 0.06);
    const qTorso = new THREE.Quaternion().setFromUnitVectors(UP, up);
    this.place("chestTop", chestTop, qTorso);
    this.place("chestLow", chestLow, qTorso);
    this.place("hipBall", hipBall, qTorso);
    this.stretch("chest", chestLow, chestTop);
    this.stretch("belly", hipC.clone().addScaledVector(up, 0.12), chestLow);
    this.stretch("pelvis", hipC.clone().addScaledVector(up, -0.02), hipC.clone().addScaledVector(up, 0.13));
    for (const k of ["chest", "belly", "pelvis"]) {
      const l = this.limbs[k];
      l.mesh.scale.x = l.ink.scale.x = k === "chest" ? 1.4 : 1.25;
      l.mesh.scale.z = l.ink.scale.z = 0.82;
    }

    // arms
    const L1 = 0.29, L2 = 0.27;
    const sides: ["l" | "r", number][] = [["l", -1], ["r", 1]];
    for (const [s, sx] of sides) {
      const S = sh.clone().add(new THREE.Vector3(sx * 0.2, -0.02, 0));
      const H = new THREE.Vector3(sx * 0.34, 0.03, 0.04);
      const wrist = H.clone().add(new THREE.Vector3(0, 0.02, -0.03));
      const E = this.elbow(S, wrist, L1, L2, new THREE.Vector3(sx, 0.15, -0.55));
      const sleeveEnd = S.clone().lerp(E, 0.48);
      this.place(s + "Shoulder", S);
      this.stretch(s + "Sleeve", S, sleeveEnd);
      this.stretch(s + "Upper", sleeveEnd, E);
      this.place(s + "Elbow", E);
      this.stretch(s + "Fore", E, wrist);
      this.place(s + "Hand", H, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sx * 0.25, 0)));
      // fingers spread forward on the floor, thumb pointing in
      for (let f = 0; f < 5; f++) {
        const thumb = f === 0;
        const ang = thumb ? -sx * 1.0 : sx * (-0.25 + (f - 1) * 0.17);
        const base = H.clone().add(new THREE.Vector3(thumb ? -sx * 0.03 : sx * (-0.022 + (f - 1) * 0.015), -0.012, thumb ? 0.0 : 0.035));
        const len = thumb ? 0.04 : f === 2 ? 0.055 : f === 4 ? 0.04 : 0.05;
        const tip = base.clone().add(new THREE.Vector3(Math.sin(ang) * len, -0.008, Math.cos(ang) * len));
        this.stretch(s + "Finger" + f, base, tip);
      }
      this.pts[s === "l" ? LM.ls : LM.rs].copy(S);
      this.pts[s === "l" ? LM.le : LM.re].copy(E);
      this.pts[s === "l" ? LM.lw : LM.rw].copy(wrist);

      // legs
      const hp = hipC.clone().add(new THREE.Vector3(sx * 0.1, 0, 0));
      const kn = kneeC.clone().add(new THREE.Vector3(sx * 0.11, 0, 0));
      const an = ankC.clone().add(new THREE.Vector3(sx * 0.1, 0, 0));
      this.stretch(s + "Thigh", hp, kn);
      this.place(s + "Knee", kn);
      this.stretch(s + "Shin", kn, an);
      this.place(s + "Ankle", an);
      const toe = an.clone().add(knees > 0.5 ? new THREE.Vector3(0, 0.0, -0.13) : new THREE.Vector3(0, -0.07, 0.06));
      const heel = an.clone().add(knees > 0.5 ? new THREE.Vector3(0, 0.05, 0.02) : new THREE.Vector3(0, 0.03, -0.05));
      this.stretch(s + "Shoe", heel, toe);
      this.place(s + "Toe", toe);
      this.place(s + "Heel", heel);
      this.pts[s === "l" ? LM.lh : LM.rh].copy(hp);
      this.pts[s === "l" ? LM.lk : LM.rk].copy(kn);
      this.pts[s === "l" ? LM.la : LM.ra].copy(an);
    }

    // loose tee: sits on the belly, sags toward the floor and ripples
    {
      const mid = hipC.clone().addScaledVector(up, 0.27);
      this.shirt.position.copy(mid);
      this.shirtInk.position.copy(mid);
      this.shirt.quaternion.copy(qTorso);
      this.shirtInk.quaternion.copy(qTorso);
      this.shirt.scale.set(1.32, 1, 0.86);
      this.shirtInk.scale.set(1.32 * 1.06, 1, 0.86 * 1.08);
      const pos = (this.shirt.geometry as THREE.CylinderGeometry).attributes.position as THREE.BufferAttribute;
      const b = this.shirtBase;
      for (let v = 0; v < pos.count; v++) {
        const x = b[v * 3], y = b[v * 3 + 1], z = b[v * 3 + 2];
        const belly = Math.max(0, z / 0.15); // local +z is the floor side
        const sag = belly * belly * (0.016 + 0.008 * Math.sin(time * 3.1 + y * 14 + x * 9));
        pos.setXYZ(v, x * (1 + 0.03 * belly), y, z + sag);
      }
      pos.needsUpdate = true;
    }

    // hair moves with the push-up and a little breeze
    const bob = Math.cos(depth * Math.PI) * 0.6;
    for (const sp of this.spikes) {
      const wob = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        Math.sin(time * 2.3 + sp.phase) * sp.amp * 0.6 + bob * 0.05,
        0,
        Math.sin(time * 1.7 + sp.phase * 1.3) * sp.amp * 0.5,
      ));
      sp.m.quaternion.copy(sp.q).multiply(wob);
      sp.ink.quaternion.copy(sp.m.quaternion);
    }

    // neck and head: the face looks down and a little ahead at the floor
    const neckTop = sh.clone().addScaledVector(up, 0.09).addScaledVector(belly, -0.01);
    this.stretch("neck", sh.clone().addScaledVector(up, -0.02), neckTop);
    const headC = neckTop.clone().addScaledVector(up, 0.07).addScaledVector(belly, -0.02);
    this.head.position.copy(headC);
    const face = belly.clone().multiplyScalar(0.22).addScaledVector(up, 1).normalize();
    const headUp = up.clone().multiplyScalar(-0.22).addScaledVector(belly, -1).normalize();
    // build a basis: z = face, y = top of head
    const zA = face, xA = new THREE.Vector3().crossVectors(headUp, zA).normalize(), yA = new THREE.Vector3().crossVectors(zA, xA);
    this.head.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA));
    this.pts[LM.nose].copy(headC);

    // headband tails flutter
    this.tails.forEach((t, i) => {
      const pos = (t.geometry as THREE.PlaneGeometry).attributes.position as THREE.BufferAttribute;
      const b = this.tailBase[i];
      for (let v = 0; v < pos.count; v++) {
        const y = b[v * 3 + 1];
        const k = -y / 0.24;
        pos.setZ(v, Math.sin(time * 7 + k * 5 + i) * 0.03 * k);
        pos.setX(v, b[v * 3] + Math.sin(time * 5 + k * 3 + i * 2) * 0.012 * k);
      }
      pos.needsUpdate = true;
    });
  }

  // world positions of the faked landmarks (for the orange tracking lines)
  landmark(id: number, out: THREE.Vector3) {
    this.root.updateMatrixWorld();
    return out.copy(this.pts[id]).applyMatrix4(this.body.matrixWorld);
  }
}
