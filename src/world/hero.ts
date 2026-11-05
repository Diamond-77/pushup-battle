import * as THREE from "three";
import { toonGradient } from "../demo/figure";

// The explorer: the same guy as in the how-to-play guide (blank face, red headband, white tee,
// black pants, green shoes), built as a small jointed rig so he can walk and run.
// Feet are at y = 0, he faces +z, about 1.75 m tall.

const C = { skin: 0xf3c9a4, tee: 0xf7f7f2, pants: 0x1a1b22, shoe: 0x2fd65a, sole: 0xf2f2f2, hair: 0x232a44, band: 0xe0313c, ink: 0x14100e };

export class Hero {
  root = new THREE.Group();
  private body = new THREE.Group();
  private hips: THREE.Group[] = [];
  private knees: THREE.Group[] = [];
  private shoulders: THREE.Group[] = [];
  private elbows: THREE.Group[] = [];
  private head = new THREE.Group();
  private tails: THREE.Mesh[] = [];
  private phase = 0;
  private ink = new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide });
  private mats: Record<string, THREE.MeshToonMaterial> = {};
  private air = 0;
  private waveT = -1;

  // colors: swap any part's colour (e.g. a blue tee for another player)
  constructor(colors: Partial<typeof C> = {}) {
    const pal = { ...C, ...colors };
    const mat = (k: keyof typeof C) => (this.mats[k] ??= new THREE.MeshToonMaterial({ color: pal[k], gradientMap: toonGradient() }));
    // a part with an ink outline (a slightly bigger back-facing copy)
    const part = (geo: THREE.BufferGeometry, k: keyof typeof C, parent: THREE.Object3D, x = 0, y = 0, z = 0, line = 0.018) => {
      const m = new THREE.Mesh(geo, mat(k));
      m.position.set(x, y, z);
      const o = new THREE.Mesh(geo, this.ink);
      geo.computeBoundingSphere();
      const r = geo.boundingSphere!.radius;
      o.scale.setScalar(1 + line / Math.max(0.05, r));
      m.add(o);
      parent.add(m);
      return m;
    };
    const limb = (r0: number, r1: number, len: number) => new THREE.CapsuleGeometry((r0 + r1) / 2, len, 4, 10).translate(0, -len / 2, 0);

    this.root.add(this.body);
    this.body.position.y = 0.95;

    // torso: pants at the hips, tee above
    part(new THREE.CapsuleGeometry(0.13, 0.1, 4, 12).scale(1.25, 1, 0.85), "pants", this.body, 0, 0.02, 0);
    const chest = part(new THREE.CapsuleGeometry(0.15, 0.26, 4, 12).scale(1.3, 1, 0.8), "tee", this.body, 0, 0.3, 0);
    chest.rotation.x = 0.04;
    part(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), "skin", this.body, 0, 0.53, 0);

    // head: blank face, spiky hair, headband with tails
    this.head.position.set(0, 0.68, 0);
    this.body.add(this.head);
    part(new THREE.SphereGeometry(0.13, 18, 14).scale(0.92, 1.08, 1), "skin", this.head);
    const hair = part(new THREE.SphereGeometry(0.14, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 1.05, 1.05), "hair", this.head, 0, 0.015, -0.01);
    hair.rotation.x = -0.25;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const spike = part(new THREE.ConeGeometry(0.045, 0.16, 5), "hair", this.head, Math.sin(a) * 0.09, 0.11 + Math.cos(a) * 0.02, Math.cos(a) * 0.09 - 0.03, 0.01);
      spike.rotation.set(-Math.cos(a) * 0.9 - 0.3, 0, Math.sin(a) * 0.9);
    }
    part(new THREE.CylinderGeometry(0.142, 0.142, 0.045, 18, 1, true), "band", this.head, 0, 0.05, 0, 0.01);
    for (const s of [-1, 1]) {
      const tail = part(new THREE.BoxGeometry(0.035, 0.24, 0.012).translate(0, -0.12, 0), "band", this.head, s * 0.03, 0.05, -0.14, 0.008);
      this.tails.push(tail);
    }

    // arms: shoulder -> upper arm (short sleeve) -> elbow -> forearm -> hand
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.21, 0.47, 0);
      this.body.add(sh);
      part(new THREE.SphereGeometry(0.07, 12, 10), "tee", sh);
      part(new THREE.CylinderGeometry(0.068, 0.062, 0.13, 12).translate(0, -0.06, 0), "tee", sh);
      part(limb(0.045, 0.04, 0.2), "skin", sh, 0, -0.02, 0);
      const el = new THREE.Group();
      el.position.y = -0.27;
      sh.add(el);
      part(limb(0.04, 0.035, 0.2), "skin", el);
      part(new THREE.SphereGeometry(0.048, 10, 8).scale(1, 1.1, 0.8), "skin", el, 0, -0.27, 0);
      this.shoulders.push(sh);
      this.elbows.push(el);
    }

    // legs: hip -> thigh -> knee -> shin -> shoe
    for (const s of [-1, 1]) {
      const hp = new THREE.Group();
      hp.position.set(s * 0.095, -0.02, 0);
      this.body.add(hp);
      part(limb(0.075, 0.065, 0.33), "pants", hp);
      const kn = new THREE.Group();
      kn.position.y = -0.43;
      hp.add(kn);
      part(limb(0.062, 0.05, 0.34), "pants", kn);
      part(new THREE.BoxGeometry(0.12, 0.08, 0.26).translate(0, -0.46, 0.05), "shoe", kn, 0, 0, 0, 0.012);
      part(new THREE.BoxGeometry(0.125, 0.025, 0.27).translate(0, -0.5, 0.05), "sole", kn, 0, 0, 0, 0.008);
      this.hips.push(hp);
      this.knees.push(kn);
    }

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

  // speed in m/s (0 = standing), airborne while jumping or falling; call every frame
  animate(speed: number, dt: number, t: number, airborne = false) {
    this.air += ((airborne ? 1 : 0) - this.air) * Math.min(1, dt * 12);
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
    this.tails.forEach((tl, i) => {
      tl.rotation.x = -0.4 - run * 0.9 + Math.sin(t * 7 + i) * 0.12;
      tl.rotation.z = (i ? 1 : -1) * 0.15;
    });
  }
}
