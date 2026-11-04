import * as THREE from "three";
import { buildPalace, rngFrom, softTexture } from "../palace/buildPalace";
import { buildArasaka } from "../palace/arasaka";
import { ENVS } from "../palace/weather";
import { CLANS, type Clan } from "../clans";

// The open-world map: one floating continent above a sea of clouds, with the three clan empires on it.
// Each empire keeps its own weather (Arasaka storm in the north, Soraran Gate sunset in the west,
// sleepBuilders moonlit night in the east) and the weather blends across the borders.
// Units are metres, the same as the palaces, so a character can walk on it later.

export type Site = { clan: Clan; pos: THREE.Vector3; region: string; blurb: string; lift: number };

const PALACE_SCALE = 0.62;
const R = 380; // island radius (coast)

// where things are, x = east, z = south
// flat = radius of level ground the palace stands on, lift = label height above it
const SPOTS: Record<string, { x: number; z: number; region: string; blurb: string; flat: number; lift: number; scale: number }> = {
  arasaka: { x: -10, z: -250, region: "Storm Peaks", blurb: "Thunder never leaves these cliffs.", flat: 84, lift: 70, scale: 0.6 },
  "soraran-gate": { x: -175, z: 30, region: "Sunset Gate", blurb: "The sun hangs low here and never quite sets.", flat: 44, lift: 30, scale: PALACE_SCALE },
  sleepbuilders: { x: 160, z: 140, region: "Moonlit Hollow", blurb: "Night without end, lit by lanterns and fireflies.", flat: 44, lift: 30, scale: PALACE_SCALE },
};
export const CROSSROADS = new THREE.Vector3(0, 0, -20);

// how each region's weather colours the land (multiplied in)
const TINT: Record<string, THREE.Color> = {
  arasaka: new THREE.Color(0x8c95a8),
  "soraran-gate": new THREE.Color(0xffc8a0),
  sleepbuilders: new THREE.Color(0x7484c4),
};
const GRASS: Record<string, [number, number]> = {
  arasaka: [0x5f7458, 0x46594a],
  "soraran-gate": [0xb8b45a, 0x8fa24e],
  sleepbuilders: [0x4f8a7a, 0x3d6e6a],
};

/* ---------- small noise ---------- */

function noise2(x: number, z: number) {
  return (
    Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.013 - 0.7) * 0.5 +
    Math.sin(x * 0.027 - z * 0.019 + 2.1) * 0.3 +
    Math.sin(x * 0.061 + z * 0.047 + 0.4) * Math.cos(z * 0.071 - x * 0.02) * 0.2
  );
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ---------- layout ---------- */

const ids = CLANS.map((c) => c.id);
const site = (id: string) => new THREE.Vector2(SPOTS[id].x, SPOTS[id].z);

// region weights: closer empire wins, with a soft border
function weights(x: number, z: number) {
  const d = ids.map((id) => Math.hypot(x - SPOTS[id].x, z - SPOTS[id].z));
  const w = d.map((v) => Math.exp(-v / 55));
  const sum = w.reduce((a, b) => a + b, 0);
  return { w: w.map((v) => v / sum), d };
}

// roads: gentle curves from the crossroads to each palace gate
const ROADS = ids.map((id) => {
  const a = new THREE.Vector2(CROSSROADS.x, CROSSROADS.z), b = site(id);
  const mid = a.clone().lerp(b, 0.5);
  const n = new THREE.Vector2(-(b.y - a.y), b.x - a.x).normalize().multiplyScalar(28);
  const toGate = a.clone().sub(b).normalize().multiplyScalar(48); // stop at the palace's front
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(a.x, 0, a.y),
    new THREE.Vector3(mid.x + n.x, 0, mid.y + n.y),
    new THREE.Vector3(b.x + toGate.x, 0, b.y + toGate.y),
  ]);
  return curve.getSpacedPoints(80).map((p) => new THREE.Vector2(p.x, p.z));
});
function roadDist(x: number, z: number) {
  let best = 1e9;
  for (const pts of ROADS)
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i].x, az = pts[i].y, bx = pts[i + 1].x - ax, bz = pts[i + 1].y - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz)));
      const dx = x - ax - bx * t, dz = z - az - bz * t;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
  return Math.sqrt(best);
}

const coast = (a: number) => R + 26 * Math.sin(3 * a + 1) + 16 * Math.sin(7 * a + 2) + 8 * Math.sin(13 * a);

// height of the land at (x, z)
export function heightAt(x: number, z: number, road = roadDist(x, z)) {
  const r = Math.hypot(x, z), a = Math.atan2(z, x);
  const { d } = weights(x, z);
  const s = [...d].sort((p, q) => p - q);
  let h = 3 + noise2(x, z) * 7 + noise2(x * 2.3 + 40, z * 2.3) * 3;
  // mountain ridges along the borders between empires, opening up at the crossroads
  const border = s[1] - s[0];
  const dc = Math.hypot(x - CROSSROADS.x, z - CROSSROADS.z);
  h += Math.exp(-((border / 46) ** 2)) * smooth(70, 170, dc) * (46 + 34 * noise2(x * 1.7, z * 1.7 + 90));
  // hills behind each palace
  h += Math.max(0, noise2(x * 0.7 - 30, z * 0.7)) * 26 * smooth(90, 160, s[0]);
  // flat ground for palaces, the crossroads and the roads
  ids.forEach((id, i) => (h = THREE.MathUtils.lerp(h, 0, smooth(SPOTS[id].flat + 26, SPOTS[id].flat, d[i]))));
  h = THREE.MathUtils.lerp(h, 0.5, smooth(48, 28, dc));
  h = THREE.MathUtils.lerp(h, Math.min(h, 1.2), smooth(16, 6, road));
  // cliffs down to the cloud sea
  const edge = smooth(coast(a), coast(a) - 46, r);
  return THREE.MathUtils.lerp(-70, h, edge);
}

/* ---------- painted textures ---------- */

function cloudTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const x = c.getContext("2d")!;
  const r = rngFrom("clouds");
  for (let i = 0; i < 90; i++) {
    const px = r() * 512, py = r() * 512, rad = 30 + r() * 80;
    for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) {
      const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rad);
      g.addColorStop(0, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g;
      x.fillRect(px + ox - rad, py + oy - rad, rad * 2, rad * 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 5);
  return t;
}

let ramp: THREE.DataTexture | null = null;
function softRamp() {
  if (ramp) return ramp;
  const d = new Uint8Array([90, 90, 90, 255, 150, 150, 150, 255, 210, 210, 210, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}
const toon = (color: number, extra: Partial<THREE.MeshToonMaterialParameters> = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: softRamp(), ...extra });

// a region's weather tint at a point
function tintAt(x: number, z: number, out: THREE.Color) {
  const { w } = weights(x, z);
  out.setRGB(0, 0, 0);
  ids.forEach((id, i) => {
    out.r += TINT[id].r * w[i];
    out.g += TINT[id].g * w[i];
    out.b += TINT[id].b * w[i];
  });
  return out;
}

/* ---------- the world ---------- */

export function buildWorld(scene: THREE.Scene) {
  const rand = rngFrom("world-map");
  const root = new THREE.Group();
  scene.add(root);
  const tmp = new THREE.Color(), tint = new THREE.Color(), c2 = new THREE.Color();

  // sky: storm grey to the north, sunset to the west, night to the east
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1800, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir;
        void main(){
          vec2 d = normalize(vDir.xz + 1e-5);
          float storm = pow(max(0.0, dot(d, vec2(0.0,-1.0))), 2.0);
          float dusk  = pow(max(0.0, dot(d, vec2(-1.0,0.15))), 2.0);
          float night = pow(max(0.0, dot(d, vec2(0.75,0.65))), 1.5);
          float sum = storm + dusk + night + 0.05;
          float y = clamp(vDir.y, 0.0, 1.0);
          vec3 sTop = vec3(0.09,0.10,0.13), sLow = vec3(0.30,0.33,0.38);
          vec3 dTop = vec3(0.25,0.24,0.45), dLow = vec3(1.00,0.70,0.45);
          vec3 nTop = vec3(0.02,0.03,0.09), nLow = vec3(0.17,0.21,0.36);
          float k = pow(y, 0.55);
          vec3 c = (mix(sLow,sTop,k)*storm + mix(dLow,dTop,k)*dusk + mix(nLow,nTop,k)*night + vec3(0.5,0.5,0.55)*0.05) / sum;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // lights: a dusky in-between light; each region's colour comes from its tint
  scene.add(new THREE.HemisphereLight(0xe8e4ff, 0x4a4436, 1.25));
  const sun = new THREE.DirectionalLight(0xffe0bc, 2.1);
  sun.position.set(-300, 260, 160);
  scene.add(sun);
  const bolt = new THREE.PointLight(0xdfe8ff, 0, 520, 0);
  bolt.position.set(SPOTS.arasaka.x, 140, SPOTS.arasaka.z);
  scene.add(bolt);
  const duskGlow = new THREE.PointLight(0xffa060, 2.2, 300, 0);
  duskGlow.position.set(SPOTS["soraran-gate"].x - 80, 60, SPOTS["soraran-gate"].z);
  scene.add(duskGlow);
  const moonGlow = new THREE.PointLight(0x9fb4ff, 1.6, 300, 0);
  moonGlow.position.set(SPOTS.sleepbuilders.x + 40, 120, SPOTS.sleepbuilders.z);
  scene.add(moonGlow);

  /* land */
  const N = 180, SIZE = 2 * (R + 70);
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const roads = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    roads[i] = roadDist(x, z);
    pos.setY(i, heightAt(x, z, roads[i]));
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const { w } = weights(x, z);
    tmp.setRGB(0, 0, 0);
    ids.forEach((id, k) => {
      c2.set(GRASS[id][(noise2(x * 3, z * 3) > 0 ? 0 : 1)]);
      tmp.r += c2.r * w[k];
      tmp.g += c2.g * w[k];
      tmp.b += c2.b * w[k];
    });
    const steep = 1 - nrm.getY(i);
    if (y < -4) tmp.lerp(c2.set(0x6b625a), smooth(-4, -30, y)); // cliff face
    tmp.lerp(c2.set(0x8a8478), smooth(0.12, 0.35, steep)); // bare rock on slopes
    tmp.lerp(c2.set(0xf4f2ee), smooth(46, 64, y)); // snowy ridge tops
    tmp.lerp(c2.set(0xcab68e), smooth(9, 4, roads[i]) * (y > -4 ? 1 : 0)); // roads
    tmp.multiply(tintAt(x, z, tint));
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const land = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
  land.name = "land";
  root.add(land);

  // the island's underside, so it reads as floating when seen from the side
  const under = new THREE.Mesh(
    new THREE.ConeGeometry(R * 0.95, 260, 40, 6, true),
    toon(0x5a5048, { side: THREE.DoubleSide }),
  );
  under.rotation.x = Math.PI;
  under.position.y = -70 - 128;
  root.add(under);

  // sea of clouds below
  const cloudTex = cloudTexture();
  const sea = new THREE.Mesh(
    new THREE.CircleGeometry(1700, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x9aa0b8, transparent: true, opacity: 0.95, map: cloudTex, depthWrite: false }),
  );
  sea.position.y = -60;
  const seaBase = new THREE.Mesh(new THREE.CircleGeometry(1700, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5d6380 }));
  seaBase.position.y = -64;
  root.add(seaBase, sea);

  /* crossroads: a stone plaza with a tall jade stele (the future throne) */
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(26, 27, 1, 40), toon(0xd9cfb8));
  plaza.position.set(CROSSROADS.x, 0.3, CROSSROADS.z);
  root.add(plaza);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(18, 0.6, 6, 40).rotateX(Math.PI / 2), toon(0x8e7f66));
  ring.position.set(CROSSROADS.x, 0.85, CROSSROADS.z);
  root.add(ring);
  const stele = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.6, 16, 6), toon(0x3fbf8a, { emissive: 0x0f4a33, emissiveIntensity: 0.6 }));
  stele.position.set(CROSSROADS.x, 8.8, CROSSROADS.z);
  root.add(stele);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 1.6, 6), toon(0x9a8f7c));
  base.position.set(CROSSROADS.x, 1.4, CROSSROADS.z);
  root.add(base);

  /* palaces */
  const sites: Site[] = [];
  for (const clan of CLANS) {
    const sp = SPOTS[clan.id];
    const env = ENVS[clan.weather];
    const { root: palace } = clan.id === "arasaka" ? buildArasaka(env, { bare: true }) : buildPalace(clan.name, env, clan.palace, { bare: true });
    palace.scale.setScalar(sp.scale);
    palace.position.set(sp.x, 0, sp.z);
    // face the crossroads (the palace gate is at +z)
    palace.rotation.y = Math.atan2(CROSSROADS.x - sp.x, CROSSROADS.z - sp.z);
    // colour it with its own weather
    const t = TINT[clan.id].clone().lerp(new THREE.Color(0xffffff), clan.id === "arasaka" ? 0.7 : 0.25); // Arasaka is already dark
    const seen = new Set<THREE.Material>();
    palace.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!m || seen.has(m)) return;
      seen.add(m);
      if ("color" in m && m.type !== "LineBasicMaterial") (m as THREE.MeshToonMaterial).color.multiply(t);
    });
    root.add(palace);
    sites.push({ clan, pos: new THREE.Vector3(sp.x, 0, sp.z), region: sp.region, blurb: sp.blurb, lift: sp.lift });
  }

  /* trees, karst pillars and floating rocks */
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const MAX = 1400;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.7, 5, 5), toon(0xffffff), MAX);
  const blob = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3, 0), toon(0xffffff), MAX * 2);
  const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(3.2, 4.4, 7), toon(0xffffff), MAX * 3);
  for (const im of [trunk, blob, cone]) im.count = 0;
  const put = (im: THREE.InstancedMesh, x: number, y: number, z: number, s: number, color: THREE.Color, spin = true) => {
    if (im.count >= im.instanceMatrix.count) return;
    q.setFromEuler(new THREE.Euler(spin ? rand() * 3 : 0, rand() * 3, spin ? rand() * 3 : 0));
    m4.compose(p.set(x, y, z), q, sc.setScalar(s));
    im.setMatrixAt(im.count, m4);
    im.setColorAt(im.count++, color);
  };
  const pillars: THREE.Vector2[] = [];
  const pillarGeos: THREE.BufferGeometry[] = [];
  const rockCol = new THREE.Color();
  const pillar = (x: number, z: number, h: number, w: number, y0: number, shade: number, float = false) => {
    const g = new THREE.CylinderGeometry(w * (0.15 + rand() * 0.2), w, h, 8, 8);
    const gp = g.attributes.position, cols: number[] = [];
    const ph = rand() * 6, lean = (rand() - 0.5) * h * 0.12;
    for (let k = 0; k < gp.count; k++) {
      const vx = gp.getX(k), vy = gp.getY(k), vz = gp.getZ(k), t = vy / h + 0.5, ang = Math.atan2(vz, vx);
      const s = 1 + 0.22 * Math.sin(vy * 0.12 + ph) + 0.15 * Math.sin(ang * 3 + ph);
      gp.setXYZ(k, vx * s + lean * t * t, vy, vz * s);
      rockCol.set(t > 0.9 && !float ? 0x6f9a5a : t > 0.4 ? 0xa39e93 : 0x7f7a70).multiplyScalar(shade).multiply(tintAt(x, z, tint));
      cols.push(rockCol.r, rockCol.g, rockCol.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    g.deleteAttribute("uv");
    if (float) g.rotateX(Math.PI);
    g.computeVertexNormals();
    g.translate(x, y0 + h / 2, z);
    pillarGeos.push(g);
  };
  // karst pillars, mostly in the storm and night lands
  for (let i = 0; i < 400 && pillars.length < 46; i++) {
    const a = rand() * Math.PI * 2, r = 60 + rand() * (R - 90);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const { w, d } = weights(x, z);
    if (ids.some((id, k) => d[k] < SPOTS[id].flat + 40) || roadDist(x, z) < 22 || Math.hypot(x - CROSSROADS.x, z - CROSSROADS.z) < 60) continue;
    if (rand() < w[1] * 0.7) continue; // fewer in the gentle sunset land
    if (pillars.some((o) => o.distanceTo(new THREE.Vector2(x, z)) < 26)) continue;
    // keep the view from the crossroads side of each palace clear
    if (ids.some((id) => {
      const sx = SPOTS[id].x, sz = SPOTS[id].z, dx = x - sx, dz = z - sz, len = Math.hypot(dx, dz);
      const cx = CROSSROADS.x - sx, cz = CROSSROADS.z - sz;
      return len < 190 && (dx * cx + dz * cz) / (len * Math.hypot(cx, cz)) > 0.2;
    })) continue;
    pillars.push(new THREE.Vector2(x, z));
    const y = heightAt(x, z);
    pillar(x, z, 40 + rand() * 80, 9 + rand() * 9, y - 6, w[0] > 0.5 ? 0.75 : 1);
  }
  // floating rocks off the coast, each with a little tree
  const floaters: { g: THREE.Group; y: number; ph: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand() * 0.4, r = R + 40 + rand() * 90;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = 10 + rand() * 50;
    pillar(0, 0, 18 + rand() * 16, 8 + rand() * 6, -26, 1, true);
    const g = new THREE.Group();
    const rock = new THREE.Mesh(pillarGeos.pop()!, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp() }));
    const top = new THREE.Mesh(new THREE.CylinderGeometry(7, 5, 2, 8), toon(0x6f9a5a).clone());
    (top.material as THREE.MeshToonMaterial).color.multiply(tintAt(x, z, tint));
    top.position.y = 1;
    const tr = new THREE.Mesh(new THREE.ConeGeometry(3, 7, 7), toon(0x2f5f3e));
    tr.position.set(1, 5.5, 0);
    g.add(rock, top, tr);
    g.position.set(x, y, z);
    root.add(g);
    floaters.push({ g, y, ph: rand() * 6 });
  }
  if (pillarGeos.length) {
    // one mesh for every pillar
    const merged = new THREE.BufferGeometry();
    const P: number[] = [], C: number[] = [];
    for (const g of pillarGeos) {
      const ng = g.index ? g.toNonIndexed() : g;
      P.push(...(ng.attributes.position.array as Float32Array));
      C.push(...(ng.attributes.color.array as Float32Array));
    }
    merged.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    merged.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
    merged.computeVertexNormals();
    root.add(new THREE.Mesh(merged, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp() })));
  }

  // forests: pines in the storm, maples in the sunset, blue pines and bamboo-ish puffs at night
  const leafC = new THREE.Color(), trunkC = new THREE.Color();
  for (let i = 0; i < 5000 && trunk.count < MAX; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * (R - 30);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - CROSSROADS.x, z - CROSSROADS.z) < 34 || roadDist(x, z) < 9) continue;
    const { w, d } = weights(x, z);
    if (ids.some((id, k) => d[k] < SPOTS[id].flat + 8)) continue;
    if (pillars.some((o) => Math.hypot(o.x - x, o.y - z) < 14)) continue;
    const y = heightAt(x, z);
    if (y > 44 || y < -2) continue;
    // clumps: thin out by noise so there are meadows and woods
    if (noise2(x * 2.1 + 7, z * 2.1) < -0.05 && rand() < 0.85) continue;
    const kind = w[0] > 0.5 ? 0 : w[1] > 0.5 ? 1 : 2;
    const t = tintAt(x, z, tint);
    const k = 0.8 + rand() * 0.7;
    trunkC.set(0x5c3e2b).multiply(t);
    put(trunk, x, y + 2.5 * k, z, k, trunkC, false);
    if (kind === 1 && rand() < 0.75) {
      for (let j = 0; j < 2; j++) {
        leafC.set([0xe0743a, 0xc9462e, 0xf0a640, 0x8fb24e][Math.floor(rand() * 4)]).multiply(t);
        put(blob, x + (rand() - 0.5) * 3 * k, y + (6 + rand() * 2) * k, z + (rand() - 0.5) * 3 * k, k * (0.8 + rand() * 0.4), leafC);
      }
    } else if (kind === 2 && rand() < 0.35) {
      leafC.set(rand() < 0.5 ? 0x5fa08a : 0x3f7d72).multiply(t);
      put(blob, x, y + 6.5 * k, z, k, leafC);
    } else {
      leafC.set(kind === 0 ? 0x2c4a3a : 0x2e5a5a).multiply(t);
      for (let j = 0; j < 3; j++) put(cone, x, y + (4.5 + j * 2.1) * k, z, k * (1.2 - j * 0.25), leafC, false);
    }
  }
  for (const im of [trunk, blob, cone]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    root.add(im);
  }

  // lanterns along the roads
  const glow = softTexture();
  const lamps = new THREE.Group();
  for (const pts of ROADS)
    for (let i = 6; i < pts.length - 2; i += 6) {
      const a = pts[i], b = pts[i + 1];
      const n = new THREE.Vector2(-(b.y - a.y), b.x - a.x).normalize().multiplyScalar(i % 12 ? 6 : -6);
      const x = a.x + n.x, z = a.y + n.y, y = heightAt(x, z);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4, 0.8), toon(0x4a2a1c));
      post.position.set(x, y + 2, z);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffb860, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.position.set(x, y + 4.6, z);
      sp.scale.setScalar(7);
      lamps.add(post, sp);
    }
  root.add(lamps);

  /* weather */

  // storm: dark clouds, rain and lightning over Arasaka
  const A = SPOTS.arasaka;
  const stormClouds = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: i % 3 ? 0x2b3038 : 0x40464f, transparent: true, opacity: 0.85, depthWrite: false }));
    const a = rand() * Math.PI * 2, r = rand() * 150;
    sp.position.set(A.x + Math.cos(a) * r * 1.4, 210 + rand() * 50, A.z - 150 + Math.sin(a) * r * 0.6);
    sp.scale.setScalar(110 + rand() * 90);
    stormClouds.add(sp);
  }
  root.add(stormClouds);
  const RAIN = 1400;
  const rainPos = new Float32Array(RAIN * 6);
  const dropAt = (i: number, y = rand() * 130) => {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 170;
    const x = A.x + Math.cos(a) * r, z = A.z - 20 + Math.sin(a) * r * 0.8;
    rainPos.set([x, y, z, x + 0.6, y + 3.2, z], i * 6);
  };
  for (let i = 0; i < RAIN; i++) dropAt(i);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xb8c6da, transparent: true, opacity: 0.5 }));
  rain.frustumCulled = false;
  root.add(rain);
  const boltLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf2f6ff, fog: false }));
  boltLine.visible = false;
  root.add(boltLine);
  let nextFlash = 2, flashT = -1;
  const strike = () => {
    let x = A.x + (rand() - 0.5) * 240, z = A.z - 90 + (rand() - 0.5) * 120, y = 220;
    const pts = [new THREE.Vector3(x, y, z)];
    while (y > 0) {
      y -= 12 + rand() * 16;
      x += (rand() - 0.5) * 22;
      z += (rand() - 0.5) * 8;
      pts.push(new THREE.Vector3(x, Math.max(heightAt(x, z), y), z));
    }
    boltLine.geometry.dispose();
    boltLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  };

  // sunset: a huge low sun in the west, warm haze and sky lanterns rising over Soraran Gate
  const S = SPOTS["soraran-gate"];
  const sunDisk = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffb070, fog: false, depthWrite: false, transparent: true }));
  sunDisk.position.set(-1500, 160, 80);
  sunDisk.scale.setScalar(900);
  const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff0c8, fog: false, depthWrite: false, transparent: true }));
  sunCore.position.copy(sunDisk.position);
  sunCore.scale.setScalar(260);
  scene.add(sunDisk, sunCore);
  const haze = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffb27a, transparent: true, opacity: 0.28, depthWrite: false }));
    sp.position.set(S.x - 60 + (rand() - 0.5) * 220, 20 + rand() * 30, S.z + (rand() - 0.5) * 240);
    sp.scale.setScalar(120 + rand() * 80);
    haze.add(sp);
  }
  root.add(haze);
  const LANTERNS = 36;
  const skyLanterns = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 2, 1.4), new THREE.MeshBasicMaterial({ color: 0xffb04a }), LANTERNS);
  const lantern = Array.from({ length: LANTERNS }, () => ({ x: S.x + (rand() - 0.5) * 160, y: rand() * 160, z: S.z + (rand() - 0.5) * 160, s: rand() * 6 }));
  root.add(skyLanterns);

  // night: a big moon in the east, stars on that side of the sky, fireflies around sleepBuilders
  const Nn = SPOTS.sleepbuilders;
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xb8c8ff, fog: false, depthWrite: false, transparent: true, opacity: 0.7 }));
  moonHalo.position.set(1100, 700, 700);
  moonHalo.scale.setScalar(520);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(70, 40), new THREE.MeshBasicMaterial({ color: 0xf4f6ff, fog: false }));
  moon.position.copy(moonHalo.position);
  moon.lookAt(0, 0, 0);
  scene.add(moonHalo, moon);
  const starPts: number[] = [];
  for (let i = 0; i < 900; i++) {
    const az = -0.2 + rand() * 2.0, el = 0.08 + rand() * 1.3;
    starPts.push(Math.cos(az) * Math.cos(el) * 1700, Math.sin(el) * 1700, Math.sin(az) * Math.cos(el) * 1700);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPts, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false })));
  const FF = 140;
  const ffBase: number[] = [];
  for (let i = 0; i < FF; i++) {
    const a = rand() * Math.PI * 2, r = 30 + rand() * 120;
    const x = Nn.x + Math.cos(a) * r, z = Nn.z + Math.sin(a) * r;
    ffBase.push(x, Math.max(0, heightAt(x, z)) + 2 + rand() * 8, z);
  }
  const ffGeo = new THREE.BufferGeometry();
  ffGeo.setAttribute("position", new THREE.Float32BufferAttribute(ffBase.slice(), 3));
  const fireflies = new THREE.Points(ffGeo, new THREE.PointsMaterial({ color: 0xd8ff7a, map: glow, size: 2.2, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  root.add(fireflies);

  // low mist drifting through the mountain passes
  const mist = new THREE.Group();
  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2, r = 120 + rand() * 220;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: tintAt(x, z, tint).clone().lerp(new THREE.Color(0xffffff), 0.4), transparent: true, opacity: 0.22, depthWrite: false }));
    sp.position.set(x, 25 + rand() * 20, z);
    sp.scale.setScalar(90 + rand() * 70);
    mist.add(sp);
  }
  root.add(mist);

  // clouds hugging the coast
  const coastClouds = new THREE.Group();
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2, r = coast(a) + 20 + rand() * 60;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: tintAt(x, z, tint).clone().lerp(new THREE.Color(0xffffff), 0.5), transparent: true, opacity: 0.8, depthWrite: false }));
    sp.position.set(x, -40 + rand() * 20, z);
    sp.scale.setScalar(110 + rand() * 90);
    coastClouds.add(sp);
  }
  root.add(coastClouds);

  // invisible hit areas for tapping a palace
  const hits: THREE.Mesh[] = sites.map((s) => {
    const r = SPOTS[s.clan.id].flat;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 40, 12), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.copy(s.pos).setY(20);
    m.userData.clan = s.clan.id;
    root.add(m);
    return m;
  });

  const tick = (t: number, dt: number) => {
    cloudTex.offset.x = t * 0.004;
    cloudTex.offset.y = t * 0.002;
    stormClouds.children.forEach((c, i) => (c.position.x += Math.sin(t * 0.15 + i) * 0.03));
    mist.children.forEach((c, i) => (c.position.x += Math.sin(t * 0.1 + i) * 0.04));
    floaters.forEach((f) => (f.g.position.y = f.y + Math.sin(t * 0.5 + f.ph) * 3));

    for (let i = 0; i < RAIN; i++) {
      const o = i * 6;
      const y = rainPos[o + 1] - dt * 90;
      if (y < 0) dropAt(i, 130);
      else {
        rainPos[o + 1] = y;
        rainPos[o + 4] = y + 3.2;
        rainPos[o] -= dt * 10;
        rainPos[o + 3] -= dt * 10;
      }
    }
    rainGeo.attributes.position.needsUpdate = true;

    nextFlash -= dt;
    if (nextFlash <= 0) { strike(); flashT = 0; nextFlash = 3 + rand() * 6; }
    let f = 0;
    if (flashT >= 0) {
      flashT += dt;
      f = flashT < 0.08 ? 1 : flashT < 0.16 ? 0.25 : flashT < 0.26 ? 0.8 : Math.max(0, 1 - (flashT - 0.26) * 4);
      if (flashT > 0.6) flashT = -1;
    }
    bolt.intensity = f * 6;
    boltLine.visible = f > 0.5;
    stormClouds.children.forEach((c) => ((c as THREE.Sprite).material.color.setHex(0x2b3038).lerp(tmp.set(0xc8d2ff), f * 0.6)));

    lantern.forEach((l, i) => {
      l.y += dt * (2 + (i % 3));
      if (l.y > 170) { l.y = 0; l.x = S.x + (rand() - 0.5) * 160; l.z = S.z + (rand() - 0.5) * 160; }
      m4.compose(p.set(l.x + Math.sin(t * 0.4 + l.s) * 3, l.y + 6, l.z), q.identity(), sc.setScalar(1));
      skyLanterns.setMatrixAt(i, m4);
    });
    skyLanterns.instanceMatrix.needsUpdate = true;

    const fp = ffGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < FF; i++)
      fp.setXYZ(i, ffBase[i * 3] + Math.sin(t * 0.5 + i) * 3, ffBase[i * 3 + 1] + Math.sin(t * 1.3 + i * 2), ffBase[i * 3 + 2] + Math.cos(t * 0.4 + i) * 3);
    fp.needsUpdate = true;
    (fireflies.material as THREE.PointsMaterial).opacity = 0.6 + Math.sin(t * 3) * 0.3;
  };

  return { sites, hits, tick, flash: () => (flashT >= 0 ? 1 : 0) };
}
