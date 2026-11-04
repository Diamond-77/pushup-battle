import * as THREE from "three";
import { buildPalace, skyTexture, softTexture } from "../palace/buildPalace";
import { ENVS } from "../palace/weather";
import { CLANS } from "../clans";
import { toonGradient } from "./figure";

// The demo's stage: a high balcony of the Soraran Gate palace at sunset, in Arasaka finish
// (black lacquer, red trim, the bolt emblem on the banners), with ink outlines like the palaces.
// Behind his back, past the railing, the Soraran Gate pagodas rise out of the evening haze.
// Units are metres. The phone sits at z = +2, he does push-ups around z = 0..-1.5.

const env = ENVS.sunset;
const toon = (color: number, extra: Partial<THREE.MeshToonMaterialParameters> = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
const INK = new THREE.LineBasicMaterial({ color: 0x1a120c });

const C = {
  lacquer: 0x221c22, // Arasaka black
  red: 0xb8302a,
  redDark: 0x7a1f1c,
  gold: 0xe0b04a,
  stone: 0xd9d1bf,
  roof: 0x2f6d6b, // Soraran Gate teal tiles
  bracket: 0x2f6f6a,
};

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

// the palace paving, a little warmer and worn, with a darker border every few tiles
function pavingTex() {
  return canvas(256, 256, (g) => {
    g.fillStyle = "#ddd5c3";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const k = (i * 7 + j * 3) % 5;
        g.fillStyle = ["#d8cfbc", "#e2dacb", "#d3cab6", "#dcd3c1", "#e5dfd1"][k];
        g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
      }
    g.strokeStyle = "#a79d88";
    g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke();
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke();
    }
  }, [6, 6]);
}


function roofTex() {
  return canvas(128, 128, (g) => {
    g.fillStyle = "#2f6d6b";
    g.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 16) {
      g.fillStyle = "#3f8a86";
      g.fillRect(x + 2, 0, 9, 128);
      g.fillStyle = "#1e4a49";
      g.fillRect(x + 11, 0, 3, 128);
    }
    for (let y = 0; y < 128; y += 32) {
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(0, y, 128, 3);
    }
  }, [6, 2]);
}

function bannerTex() {
  return canvas(128, 384, (g) => {
    g.fillStyle = "#1d171c";
    g.fillRect(0, 0, 128, 384);
    g.strokeStyle = "#c8372d";
    g.lineWidth = 8;
    g.strokeRect(10, 10, 108, 364);
    g.strokeStyle = "#e0b04a";
    g.lineWidth = 2;
    g.strokeRect(20, 20, 88, 344);
    // Arasaka emblem: red hexagon with a pale bolt
    g.save();
    g.translate(64 - 48, 110);
    g.scale(2, 2);
    g.lineJoin = "round";
    g.fillStyle = "#c8372d";
    g.strokeStyle = "#0e0b0d";
    g.lineWidth = 2.5;
    const hex = new Path2D("M24 1 46 13v26L24 51 2 39V13z");
    g.fill(hex);
    g.stroke(hex);
    g.fillStyle = "#fff4e6";
    g.fill(new Path2D("M27 9 14 29h9l-4 15 15-22h-9l4-13z"));
    g.restore();
    // tassel stripes at the bottom
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i % 2 ? "#c8372d" : "#e0b04a";
      g.fillRect(28 + i * 15, 300, 9, 50);
    }
  });
}

// a mesh with crisp ink edges (the same look as the palaces)
function piece(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, edges = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.receiveShadow = true; // only he casts shadows, so the floor stays clean
  if (edges) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), INK));
  parent.add(m);
  return m;
}

export function buildBalcony(scene: THREE.Scene) {
  scene.background = skyTexture(env.sky);
  scene.fog = new THREE.Fog(env.fog, 40, 260);
  const root = new THREE.Group();
  scene.add(root);

  // ---- floor: palace paving, a lacquered border along the railing
  const paving = pavingTex();
  paving.offset.set(0.125, 0); // a tile centred under him, so no grout line runs straight at the phone
  const floor = piece(new THREE.BoxGeometry(10, 0.3, 8), toon(0xd8cfc4, { map: paving }), root, 0, -0.15, -0.2, false);
  floor.castShadow = false;
  piece(new THREE.BoxGeometry(10, 0.04, 0.35), toon(C.redDark), root, 0, 0.02, -3.85);
  piece(new THREE.BoxGeometry(10.4, 0.5, 0.5), toon(C.lacquer), root, 0, -0.25, -4.25); // balcony edge
  piece(new THREE.BoxGeometry(10.4, 0.08, 0.6), toon(C.gold), root, 0, 0.03, -4.25);

  // ---- railing at the back and the sides: black posts, red rails, gold caps
  const post = new THREE.BoxGeometry(0.12, 0.95, 0.12);
  const cap = new THREE.SphereGeometry(0.075, 10, 8);
  const lacq = toon(C.lacquer), red = toon(C.red), gold = toon(C.gold, { emissive: 0x3a2400 });
  const rail = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 0.9));
    const ang = Math.atan2(bx - ax, bz - az);
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
      piece(post, lacq, root, x, 0.475, z);
      piece(cap, gold, root, x, 1.0, z, false);
    }
    for (const [h, t] of [[0.92, 0.09], [0.45, 0.06], [0.12, 0.06]] as const) {
      const r = piece(new THREE.BoxGeometry(t, t, len), h > 0.9 ? red : lacq, root, (ax + bx) / 2, h, (az + bz) / 2);
      r.rotation.y = ang;
    }
    // little lattice balusters between the rails
    const bal = new THREE.BoxGeometry(0.035, 0.32, 0.035);
    const m = Math.round(len / 0.18);
    for (let k = 1; k < m; k++) {
      const x = ax + ((bx - ax) * k) / m, z = az + ((bz - az) * k) / m;
      piece(bal, red, root, x, 0.69, z, false);
    }
  };
  rail(-4.9, -4.05, 4.9, -4.05);
  rail(-4.9, -4.05, -4.9, 3.2);
  rail(4.9, -4.05, 4.9, 3.2);

  // ---- two great columns, a lintel with brackets, the eave overhead
  const colH = 4.2;
  for (const sx of [-1, 1]) {
    const x = sx * 1.95;
    piece(new THREE.CylinderGeometry(0.34, 0.4, 0.35, 16), toon(C.stone), root, x, 0.175, -3.4);
    piece(new THREE.CylinderGeometry(0.26, 0.28, colH, 18), toon(C.red), root, x, colH / 2, -3.4);
    piece(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 18), gold, root, x, 0.42, -3.4, false);
    piece(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 18), gold, root, x, colH - 0.25, -3.4, false);
    // Arasaka banner hanging on the column, facing the phone
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.86, 1, 8), toon(0xffffff, { map: bannerTex(), side: THREE.DoubleSide }));
    ban.position.set(x - sx * 0.02, 2.5, -3.08);
        root.add(ban);
    bannerList.push({ mesh: ban, base: Float32Array.from(ban.geometry.attributes.position.array), phase: sx });
  }
  piece(new THREE.BoxGeometry(6.4, 0.36, 0.42), lacq, root, 0, colH + 0.05, -3.4);
  piece(new THREE.BoxGeometry(6.4, 0.08, 0.46), red, root, 0, colH - 0.17, -3.4);
  for (let i = -3; i <= 3; i++) {
    piece(new THREE.BoxGeometry(0.28, 0.2, 0.5), toon(C.bracket), root, i * 0.8, colH + 0.33, -3.35);
    piece(new THREE.BoxGeometry(0.4, 0.1, 0.6), toon(C.gold), root, i * 0.8, colH + 0.48, -3.35, false);
  }
  // eave: tiles sloping up toward the phone, with an upturned gold-tipped edge
  const eave = piece(new THREE.BoxGeometry(11, 0.12, 4.6), toon(0xffffff, { map: roofTex() }), root, 0, colH + 0.9, -1.6);
  eave.rotation.x = -0.32;
  const lip = piece(new THREE.BoxGeometry(11.2, 0.14, 0.22), lacq, root, 0, colH + 0.15, -3.75);
  lip.rotation.x = 0.4;
  for (const sx of [-1, 1]) {
    const tip = piece(new THREE.ConeGeometry(0.12, 0.6, 6), gold, root, sx * 5.5, colH + 0.35, -3.75, false);
    tip.rotation.z = -sx * 0.9;
  }

  // ---- paper lanterns hanging from the lintel
  const lanternMat = toon(0xe2483a, { emissive: 0xff6a2a, emissiveIntensity: 0.55 });
  for (const lx of [-1.0, 1.0]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6), lacq);
    cord.position.set(lx, colH - 0.45, -3.25);
    root.add(cord);
    const l = piece(new THREE.SphereGeometry(0.24, 16, 12), lanternMat, root, lx, colH - 0.95, -3.25);
    l.scale.set(1, 1.2, 1);
    l.castShadow = false;
    piece(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 12), gold, root, lx, colH - 0.64, -3.25, false);
    piece(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 12), gold, root, lx, colH - 1.26, -3.25, false);
    const tas = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, 0.3, 6), toon(C.gold));
    tas.position.set(lx, colH - 1.45, -3.25);
    root.add(tas);
    const glow = new THREE.PointLight(0xff8a4a, 1.2, 4.5, 1.6);
    glow.position.set(lx, colH - 0.95, -3.0);
    root.add(glow);
  }
  // incense burner and a couple of potted pines on the balcony
  piece(new THREE.CylinderGeometry(0.28, 0.2, 0.42, 12), toon(0x7b5a2e), root, -3.6, 0.21, -2.3);
  piece(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 12), gold, root, -3.6, 0.44, -2.3, false);
  for (const [px, pz] of [[3.9, -2.4], [-4.2, 1.6]] as const) {
    piece(new THREE.CylinderGeometry(0.3, 0.24, 0.42, 12), toon(0x2a3a4a), root, px, 0.21, pz);
    const pine = piece(new THREE.IcosahedronGeometry(0.42, 1), toon(0x3d7a45), root, px, 0.78, pz);
    pine.scale.set(1.25, 0.7, 1.1);
    const pine2 = piece(new THREE.IcosahedronGeometry(0.3, 1), toon(0x4f8f52), root, px + 0.15, 1.12, pz);
    pine2.scale.set(1.2, 0.6, 1);
  }

  // ---- the Soraran Gate palace below and beyond, in the evening haze
  const sor = CLANS.find((c) => c.id === "soraran-gate")!;
  const { root: palace, tick } = buildPalace(sor.name, env, sor.palace);
  palace.position.set(0, -7, -66);
  palace.rotation.y = 0.18;
  scene.add(palace);

  // sun and drifting haze in the sky
  const glow = softTexture();
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: env.sunDisk ?? 0xffb86b, fog: false, depthWrite: false }));
  sun.position.set(-150, 40, -260);
  sun.scale.setScalar(90);
  scene.add(sun);

  // lights: warm sunset key from the front-left so his face reads, the low sun behind for a rim
  scene.add(new THREE.HemisphereLight(env.hemiSky, env.hemiGround, 1.0));
  const key = new THREE.DirectionalLight(0xffe2c4, 1.7);
  key.position.set(-3, 6, 5);
  key.target.position.set(0, 0, -1);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(env.sun, 1.3);
  rim.position.set(-6, 3, -10);
  scene.add(rim);

  const banners = bannerList.splice(0);
  return (t: number, dt: number) => {
    tick(t, dt);
    // banners sway in the evening wind
    for (const b of banners) {
      const pos = b.mesh.geometry.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        const y = b.base[v * 3 + 1];
        const k = (0.93 - y) / 1.86; // 0 at the top, 1 at the bottom
        pos.setZ(v, Math.sin(t * 1.6 + b.phase + k * 3) * 0.06 * k);
      }
      pos.needsUpdate = true;
    }
  };
}
const bannerList: { mesh: THREE.Mesh; base: Float32Array; phase: number }[] = [];
