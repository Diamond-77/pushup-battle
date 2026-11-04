import * as THREE from "three";
import { Figure, LM, toonGradient, type Pose } from "./figure";
import { buildBalcony } from "./balcony";
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
  camera = new THREE.PerspectiveCamera(60, 1, 0.05, 900);
  me = new Figure("normal");
  ghost = new Figure("ghost");
  intruder = new Figure("intruder");
  private phone = buildPhone();
  private ruler = buildRuler();
  private tmp = new THREE.Vector3();
  private sceneTick: (t: number, dt: number) => void;
  private lastT = 0;
  private w = 1;
  private h = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sceneTick = buildBalcony(this.scene);
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
    this.sceneTick(time, Math.min(0.1, Math.max(0, time - this.lastT)));
    this.lastT = time;
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
    this.camera.fov = THREE.MathUtils.lerp(50, narrow ? 82 : 58, k);
    // lift the picture so he stands clear of the caption panel at the bottom
    this.camera.setViewOffset(this.w, this.h, 0, this.h * (narrow ? 0.07 : 0.1) * k, this.w, this.h);
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
