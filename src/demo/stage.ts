import * as THREE from "three";
import { Figure, LM, toonGradient, type Pose } from "./figure";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// The 3D park the demo plays in, the camera moves, and the screen positions
// of the figure's joints (fed to the app's real stickman drawing).

export type Shot = {
  phoneView: number; // 0 = looking at the scene from the side, 1 = what the phone camera sees
  me: Pose & { show?: number };
  ghost?: Pose & { show: number };
  intruder?: Pose & { show: number };
  phone?: number; // phone on the floor, 0..1 visible
  ruler?: number; // the "about 2 m" line, 0..1 drawn
};

const tex = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

function toon(color: number) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
}
const ink = new THREE.MeshBasicMaterial({ color: 0x1d2a1a, side: THREE.BackSide });
function inked(geo: THREE.BufferGeometry, color: number, grow = 1.06) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, toon(color));
  m.castShadow = true;
  const o = new THREE.Mesh(geo, ink);
  o.scale.setScalar(grow);
  g.add(m, o);
  return g;
}

function buildPark(scene: THREE.Scene) {
  // anime sky: deep blue at the top, warm near the horizon
  scene.background = tex(4, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#3d86e0");
    g.addColorStop(0.45, "#8cc4f2");
    g.addColorStop(0.72, "#e8efe6");
    g.addColorStop(1, "#fbe3bd");
    c.fillStyle = g;
    c.fillRect(0, 0, 4, 256);
  });
  scene.fog = new THREE.Fog(0xdfeee8, 14, 60);

  // grass with soft painted patches
  const grassTex = tex(512, 512, (c) => {
    c.fillStyle = "#6cbd4e";
    c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = Math.random() < 0.5 ? "rgba(140,210,90,0.35)" : "rgba(60,140,50,0.3)";
      c.beginPath();
      c.ellipse(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 26, 3 + Math.random() * 10, Math.random() * 3, 0, Math.PI * 2);
      c.fill();
    }
  });
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(30, 30);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshToonMaterial({ map: grassTex, gradientMap: toonGradient() }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // a stone path curving behind him
  const pathShape = new THREE.Shape();
  pathShape.moveTo(-40, -1.2);
  pathShape.bezierCurveTo(-10, -3, 5, 1, 40, -2);
  pathShape.lineTo(40, 0.4);
  pathShape.bezierCurveTo(5, 3.2, -10, -0.8, -40, 0.9);
  const path = new THREE.Mesh(new THREE.ShapeGeometry(pathShape, 40), toon(0xe9d6ac));
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.005, -6.5);
  path.receiveShadow = true;
  scene.add(path);

  // trees: round toon canopies with ink outlines
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const greens = [0x3f9a3c, 0x4fae45, 0x2f8a3e, 0x5cba52];
  const tree = (x: number, z: number, s: number) => {
    const g = new THREE.Group();
    const trunk = inked(new THREE.CylinderGeometry(0.16 * s, 0.24 * s, 2.2 * s, 8), 0x7a4a2c, 1.12);
    trunk.position.y = 1.1 * s;
    g.add(trunk);
    for (let i = 0; i < 4; i++) {
      const r = (0.9 + rnd() * 0.6) * s;
      const blob = inked(new THREE.IcosahedronGeometry(r, 2), greens[(i + Math.floor(rnd() * 4)) % 4], 1.05);
      blob.position.set((rnd() - 0.5) * 1.3 * s, 2.5 * s + rnd() * 1.1 * s, (rnd() - 0.5) * 1.1 * s);
      g.add(blob);
    }
    g.position.set(x, 0, z);
    scene.add(g);
  };
  const spots: [number, number, number][] = [
    [-5.5, -9, 1.2], [4.8, -11, 1.4], [-11, -16, 1.6], [10, -18, 1.7], [-2, -22, 1.5], [16, -12, 1.3], [-17, -10, 1.4],
    [7, -27, 1.8], [-8, -30, 1.9], [21, -26, 1.8], [-22, -24, 1.7], [0, -38, 2.2], [-4.5, 3.5, 1.1], [5.5, 4, 1.2],
  ];
  for (const [x, z, s] of spots) tree(x, z, s);
  // bushes along the path
  for (let i = 0; i < 12; i++) {
    const b = inked(new THREE.IcosahedronGeometry(0.45 + rnd() * 0.35, 1), greens[i % 4], 1.06);
    b.position.set(-14 + i * 2.6 + rnd(), 0.25, -4.2 - rnd() * 1.5 + (i % 3 === 0 ? -4.5 : 0));
    b.scale.y = 0.75;
    scene.add(b);
  }
  // a bench and two lamps
  const bench = new THREE.Group();
  const seat = inked(new THREE.BoxGeometry(1.8, 0.08, 0.45), 0xa8673a, 1.04);
  seat.position.y = 0.48;
  const back = inked(new THREE.BoxGeometry(1.8, 0.4, 0.06), 0xa8673a, 1.04);
  back.position.set(0, 0.78, -0.22);
  bench.add(seat, back);
  for (const lx of [-0.8, 0.8]) {
    const leg = inked(new THREE.BoxGeometry(0.07, 0.48, 0.4), 0x2c2f35, 1.06);
    leg.position.set(lx, 0.24, 0);
    bench.add(leg);
  }
  bench.position.set(3.2, 0, -5.2);
  bench.rotation.y = -0.35;
  scene.add(bench);
  for (const [lx, lz] of [[-3.5, -5.4], [7.5, -6.8]]) {
    const pole = inked(new THREE.CylinderGeometry(0.05, 0.07, 3.2, 8), 0x2c2f35, 1.15);
    pole.position.set(lx, 1.6, lz);
    const lamp = inked(new THREE.SphereGeometry(0.2, 12, 10), 0xfff3c4, 1.1);
    lamp.position.set(lx, 3.3, lz);
    scene.add(pole, lamp);
  }
  // far hills
  for (const [hx, hz, hs, c] of [[-30, -60, 22, 0x7fb68a], [18, -70, 28, 0x8cbf98], [55, -55, 20, 0x7aae86], [-65, -50, 18, 0x86b992]] as const) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(hs, 24, 12), toon(c));
    hill.scale.y = 0.35;
    hill.position.set(hx, 0, hz);
    scene.add(hill);
  }
  // clouds: soft painted puffs
  const puff = tex(256, 128, (c) => {
    c.fillStyle = "#ffffff";
    for (const [x, y, r] of [[70, 80, 40], [120, 62, 52], [175, 78, 38], [100, 92, 34], [150, 95, 30]]) {
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  });
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, transparent: true, opacity: 0.92, fog: false }));
    s.scale.set(18 + rnd() * 12, 9 + rnd() * 5, 1);
    s.position.set(-60 + i * 15 + rnd() * 8, 16 + rnd() * 14, -80 - rnd() * 20);
    scene.add(s);
  }
}

function buildPhone() {
  const g = new THREE.Group();
  const shell = inked(new THREE.BoxGeometry(0.078, 0.158, 0.009), 0x2a2c33, 1.08);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.148), new THREE.MeshBasicMaterial({ color: 0x3fbf8a }));
  screen.position.z = -0.0052;
  screen.rotation.y = Math.PI;
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.006, 16), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
  lens.position.set(0, 0.066, -0.0056);
  lens.rotation.y = Math.PI;
  g.add(shell, screen, lens);
  // a little stand behind it
  const stand = inked(new THREE.BoxGeometry(0.06, 0.09, 0.012), 0x55585f, 1.08);
  stand.position.set(0, -0.035, 0.045);
  stand.rotation.x = -0.5;
  g.add(stand);
  g.position.set(0, 0.126, 2.02);
  g.rotation.x = 0.12;
  return g;
}

function buildRuler() {
  const g = new THREE.Group();
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xff8a2a, dashSize: 0.025, gapSize: 0.02, linewidth: 2 }));
  line.computeLineDistances();
  g.add(line);
  // a glowing strip under the dashes so it reads on small screens
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 1), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.55 }));
  strip.rotation.x = -Math.PI / 2;
  strip.position.z = -0.5;
  g.add(strip);
  g.position.set(0, 0.008, 1.98);
  return g;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.05, 300);
  me = new Figure("normal");
  ghost = new Figure("ghost");
  intruder = new Figure("intruder");
  private phone = buildPhone();
  private ruler = buildRuler();
  private tmp = new THREE.Vector3();
  private w = 1;
  private h = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    buildPark(this.scene);
    this.scene.add(new THREE.HemisphereLight(0xdcefff, 0x5f8a45, 1.4));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(3, 6, 2);
    sun.target.position.set(0, 0, -0.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 1, far: 15 });
    sun.shadow.radius = 4;
    this.scene.add(sun, sun.target);
    this.scene.add(this.me.root, this.ghost.root, this.intruder.root, this.phone, this.ruler);
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(shot: Shot, time: number) {
    // camera: from the side over the phone, then down into the phone's eye
    const k = ease(THREE.MathUtils.clamp(shot.phoneView, 0, 1));
    const narrow = this.w / this.h < 0.8;
    const side = new THREE.Vector3(narrow ? 2.1 : 2.6, 2.3, narrow ? 4.4 : 3.8);
    const sideLook = new THREE.Vector3(0, -0.25, 0.75);
    // the phone camera: on the floor ~2 m from the hands, looking slightly up
    const eye = new THREE.Vector3(0, 0.13, 2.02);
    const eyeLook = new THREE.Vector3(0, narrow ? 0.62 : 0.5, -1.2);
    this.camera.position.lerpVectors(side, eye, k);
    this.camera.lookAt(this.tmp.lerpVectors(sideLook, eyeLook, k));
    this.camera.fov = THREE.MathUtils.lerp(50, narrow ? 70 : 54, k);
    // lift the picture so he stands clear of the caption panel at the bottom
    this.camera.setViewOffset(this.w, this.h, 0, this.h * (narrow ? 0.2 : 0.14), this.w, this.h);
    this.camera.updateProjectionMatrix();

    this.me.setPose(shot.me, time);
    this.me.root.visible = (shot.me.show ?? 1) > 0.01;
    for (const [fig, p] of [[this.ghost, shot.ghost], [this.intruder, shot.intruder]] as const) {
      if (p && p.show > 0.01) {
        fig.setPose(p, time);
        fig.setOpacity(p.show);
      } else fig.setOpacity(0);
    }
    this.phone.visible = (shot.phone ?? 0) > 0.01 && k < 0.97;
    this.phone.scale.setScalar(Math.max(0.001, (shot.phone ?? 0) * 1.6)); // a bit bigger than life so it reads
    const r = shot.ruler ?? 0;
    this.ruler.visible = r > 0.01 && k < 0.97;
    this.ruler.scale.z = Math.max(0.001, r * 1.94);
    this.renderer.render(this.scene, this.camera);
  }

  // fake MediaPipe landmarks: 0..1 screen positions of a figure's joints
  landmarks(fig: Figure) {
    const out: NormalizedLandmark[] = [];
    for (let i = 0; i < 33; i++) out.push({ x: 0, y: 0, z: 0, visibility: 0 });
    for (const id of Object.values(LM)) {
      if (id === LM.nose) continue; // no ring over the blank face
      fig.landmark(id, this.tmp).project(this.camera);
      out[id] = { x: (this.tmp.x + 1) / 2, y: (1 - this.tmp.y) / 2, z: 0, visibility: 1 };
    }
    return out;
  }

  // screen position (0..1) of a world point, for HTML labels
  toScreen(x: number, y: number, z: number) {
    this.tmp.set(x, y, z).project(this.camera);
    return { x: (this.tmp.x + 1) / 2, y: (1 - this.tmp.y) / 2 };
  }

  dispose() {
    this.renderer.dispose();
  }
}
