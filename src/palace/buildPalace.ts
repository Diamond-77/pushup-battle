import * as THREE from "three";

// Builds a stylized, overgrown sect palace. Every clan gets its own palace:
// the clan name seeds the colors, the number of tiers, the side towers and the trees.
// Units are roughly meters, so characters can walk around it later.

export type PalaceStyle = {
  wall: number; // walls and pillars
  roof: number; // roof tiles
  trim: number; // finials and ridge ornaments
  banner: number;
  mainTiers: number;
  sideTowers: 0 | 2 | 4;
  greenery: number; // 0..1, how overgrown
};

const WALLS = [0xb8352b, 0xa8442a, 0x2f7d63, 0x2c3e6b, 0x3a2c2a];
const ROOFS = [0x4a5260, 0x3f5e4f, 0x5b4a3a, 0x2f3440, 0x6a5a2e];
const BANNERS = [0xc8372d, 0x3fbf8a, 0x3b6fd1, 0xe8b84a, 0x8e44ad];

export function rngFrom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function styleFor(clan: string): PalaceStyle {
  const r = rngFrom(clan);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  return {
    wall: pick(WALLS),
    roof: pick(ROOFS),
    trim: 0xd9a441,
    banner: pick(BANNERS),
    mainTiers: 3 + Math.floor(r() * 3),
    sideTowers: pick([0, 2, 2, 4] as const),
    greenery: 0.45 + r() * 0.5,
  };
}

// Three-step ramp for a hand-painted cel look.
let ramp: THREE.DataTexture | null = null;
function toonRamp() {
  if (ramp) return ramp;
  const d = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}
const mats = new Map<string, THREE.Material>();
function toon(color: number, side: THREE.Side = THREE.FrontSide) {
  const key = color + ":" + side;
  if (!mats.has(key)) mats.set(key, new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), side }));
  return mats.get(key)!;
}

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// A hip roof with curved slopes and upturned corners, the signature of Chinese palaces.
function roofGeometry(w: number, d: number, h: number, overhang: number, lift: number) {
  const W = w / 2 + overhang, D = d / 2 + overhang;
  const ridge = Math.max(0, (w - d) / 2) * 0.8;
  const top = [new THREE.Vector3(-ridge, h, 0), new THREE.Vector3(ridge, h, 0)];
  const eave = [
    new THREE.Vector3(-W, 0, D), new THREE.Vector3(W, 0, D),
    new THREE.Vector3(W, 0, -D), new THREE.Vector3(-W, 0, -D),
  ];
  // each face: eave edge (a->b) rises to the ridge edge (c->d)
  const faces: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
    [eave[0], eave[1], top[0], top[1]],
    [eave[1], eave[2], top[1], top[1]],
    [eave[2], eave[3], top[1], top[0]],
    [eave[3], eave[0], top[0], top[0]],
  ];
  const N = 8, M = 6;
  const pos: number[] = [], idx: number[] = [];
  for (const [a, b, c, e] of faces) {
    const base = pos.length / 3;
    for (let j = 0; j <= M; j++) {
      const v = j / M;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const lo = a.clone().lerp(b, u), hi = c.clone().lerp(e, u);
        const p = lo.lerp(hi, v);
        p.y = h * Math.pow(v, 1.7); // concave slope
        const corner = Math.pow(Math.abs(u * 2 - 1), 4);
        p.y += lift * corner * Math.pow(1 - v, 2); // corners sweep up
        pos.push(p.x, p.y, p.z);
      }
    }
    for (let j = 0; j < M; j++)
      for (let i = 0; i < N; i++) {
        const k = base + j * (N + 1) + i;
        idx.push(k, k + 1, k + N + 1, k + 1, k + N + 2, k + N + 1);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function roof(w: number, d: number, s: PalaceStyle, y: number, scale = 1) {
  const g = new THREE.Group();
  const h = Math.min(w, d) * 0.42;
  const m = new THREE.Mesh(roofGeometry(w, d, h, 1.6 * scale, 1.3 * scale), toon(s.roof, THREE.DoubleSide));
  m.castShadow = true;
  g.add(m);
  const ridgeLen = Math.max(0.6, (w - d) * 0.8);
  g.add(box(ridgeLen + 0.6, 0.5 * scale, 0.5 * scale, s.roof, 0, h - 0.1, 0));
  g.position.y = y;
  return { group: g, height: h };
}

// One building: stone base, walls with pillars, and one or more roofs.
function hall(w: number, d: number, s: PalaceStyle, opts: { tiers?: number; wallH?: number; double?: boolean } = {}) {
  const g = new THREE.Group();
  const tiers = opts.tiers ?? 1;
  let y = 0, cw = w, cd = d;
  for (let t = 0; t < tiers; t++) {
    const wallH = (opts.wallH ?? 4.2) * (t === 0 ? 1 : 0.8);
    g.add(box(cw, wallH, cd, s.wall, 0, y, 0));
    g.add(box(cw + 0.2, 0.5, cd + 0.2, 0xefe6d2, 0, y + wallH - 0.9, 0)); // light frieze band
    // pillars along the front
    const n = Math.max(2, Math.round(cw / 3));
    for (let i = 0; i <= n; i++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, wallH, 6), toon(s.wall));
      p.position.set(-cw / 2 + (i * cw) / n, y + wallH / 2, cd / 2 + 0.7);
      p.castShadow = true;
      g.add(p);
    }
    y += wallH;
    const r = roof(cw + 1.4, cd + 1.4, s, y, t === tiers - 1 ? 1 : 0.8);
    if (t < tiers - 1) {
      // lower tiers get a short eave, the next floor sits on top
      r.group.scale.y = 0.45;
      g.add(r.group);
      y += r.height * 0.45 - 0.4;
      cw *= 0.78;
      cd *= 0.78;
    } else {
      g.add(r.group);
      if (opts.double) {
        const r2 = roof(cw + 3.2, cd + 3.2, s, y - 1.6, 1.1);
        r2.group.scale.y = 0.35;
        g.add(r2.group);
      }
      // golden finial on the very top
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.2, 6), toon(s.trim));
      fin.position.y = y + r.height + 1;
      g.add(fin);
      y += r.height;
    }
  }
  return { group: g, height: y };
}

// Stepped white stone terrace.
function terrace(w: number, d: number, steps: number, stepH = 1.1) {
  const g = new THREE.Group();
  for (let i = 0; i < steps; i++) g.add(box(w - i * 4, stepH, d - i * 4, i % 2 ? 0xdcd6c8 : 0xe8e3d6, 0, i * stepH, 0));
  // front stairs
  g.add(box(4, steps * stepH, 4 + steps * 2, 0xcfc8b8, 0, 0, d / 2 - 2));
  return { group: g, height: steps * stepH };
}

// Layered mountain silhouettes around the horizon, like the layers of an ink painting:
// far layers are paler and bluer, near layers greener, peaks capped with snow.
function mountains(rand: () => number) {
  const g = new THREE.Group();
  const layers = [
    { r: 420, base: 90, amp: 150, low: 0x9fb4c8, mid: 0xc4d2df, snow: 0xf7f9fc },
    { r: 330, base: 50, amp: 110, low: 0x7f97a8, mid: 0xa9b9c6, snow: 0xf2f5f8 },
    { r: 250, base: 18, amp: 45, low: 0x5f8a5a, mid: 0x7fa070, snow: 0x9fbf8a },
  ];
  const SEG = 160;
  for (const L of layers) {
    // a few random sine waves give a jagged but smooth ridge line
    const waves = Array.from({ length: 4 }, (_, i) => ({ f: 2 + i * 3 + Math.floor(rand() * 4), p: rand() * 6.28, a: 1 / (i + 1) }));
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const c = new THREE.Color();
    for (let i = 0; i <= SEG; i++) {
      const t = (i / SEG) * Math.PI * 2;
      let n = 0;
      for (const w of waves) n += Math.abs(Math.sin(t * w.f + w.p)) * w.a;
      const h = L.base + L.amp * Math.pow(n / 2.1, 1.6);
      const x = Math.cos(t) * L.r, z = Math.sin(t) * L.r;
      const rows = [-20, h * 0.55, h * 0.8, h];
      rows.forEach((y, k) => {
        pos.push(x, y, z);
        c.set(k < 2 ? L.low : h > L.base + L.amp * 0.45 ? L.snow : L.mid);
        col.push(c.r, c.g, c.b);
      });
    }
    for (let i = 0; i < SEG; i++)
      for (let k = 0; k < 3; k++) {
        const a0 = i * 4 + k, b0 = (i + 1) * 4 + k;
        idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false })));
  }
  return g;
}

// Trees and moss as instanced meshes so hundreds stay cheap on phones.
function greenery(rand: () => number, s: PalaceStyle, spots: THREE.Vector3[], roofSpots: THREE.Vector3[]) {
  const g = new THREE.Group();
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 4, 5), toon(0x6b4a32), spots.length);
  const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 0), toon(0x5fa84a), spots.length * 3);
  const dark = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.2, 0), toon(0x3f7d3a), spots.length * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  let li = 0, di = 0;
  spots.forEach((v, i) => {
    const k = 0.8 + rand() * 0.8;
    m.compose(p.set(v.x, v.y + 2 * k, v.z), q.identity(), sc.set(k, k, k));
    trunk.setMatrixAt(i, m);
    for (let j = 0; j < 3; j++) {
      q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, 0));
      m.compose(p.set(v.x + (rand() - 0.5) * 3 * k, v.y + (4.5 + rand() * 2) * k, v.z + (rand() - 0.5) * 3 * k), q, sc.setScalar(k * (0.8 + rand() * 0.5)));
      leaves.setMatrixAt(li++, m);
    }
    for (let j = 0; j < 2; j++) {
      m.compose(p.set(v.x + (rand() - 0.5) * 4 * k, v.y + (3 + rand()) * k, v.z + (rand() - 0.5) * 4 * k), q, sc.setScalar(k));
      dark.setMatrixAt(di++, m);
    }
  });
  [trunk, leaves, dark].forEach((x) => { x.castShadow = true; g.add(x); });

  // moss and vines creeping over roofs and walls
  const count = Math.floor(roofSpots.length * s.greenery);
  const moss = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.7, 0), toon(0x5a9a44), count);
  for (let i = 0; i < count; i++) {
    const v = roofSpots[Math.floor(rand() * roofSpots.length)];
    q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
    m.compose(p.set(v.x + (rand() - 0.5) * 2, v.y, v.z + (rand() - 0.5) * 2), q, sc.set(0.8 + rand(), 0.25 + rand() * 0.25, 0.8 + rand()));
    moss.setMatrixAt(i, m);
  }
  g.add(moss);
  return g;
}

function softTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,0.9)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function skyTexture() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const x = c.getContext("2d")!;
  const gr = x.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#6fa8d6");
  gr.addColorStop(0.55, "#bcd8ec");
  gr.addColorStop(1, "#f4ecdc");
  x.fillStyle = gr;
  x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildPalace(clan: string) {
  const s = styleFor(clan);
  const rand = rngFrom(clan + ":layout");
  const root = new THREE.Group();
  const roofSpots: THREE.Vector3[] = [];
  const addSpot = (x: number, y: number, z: number, n: number, spread: number) => {
    for (let i = 0; i < n; i++) roofSpots.push(new THREE.Vector3(x + (rand() - 0.5) * spread, y, z + (rand() - 0.5) * spread));
  };

  // ground: grass with gentle hills outside the compound
  const ground = new THREE.PlaneGeometry(600, 600, 60, 60);
  ground.rotateX(-Math.PI / 2);
  const gp = ground.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const d = Math.hypot(x, z);
    if (d > 70) gp.setY(i, Math.sin(x * 0.03) * Math.cos(z * 0.025) * 8 * Math.min(1, (d - 70) / 60) + (rand() - 0.5) * 1.5);
  }
  ground.computeVertexNormals();
  const g = new THREE.Mesh(ground, toon(0x86b860));
  g.receiveShadow = true;
  root.add(g);

  // stone courtyard and central path
  root.add(box(70, 0.3, 84, 0xd9d3c4, 0, 0, 0));
  root.add(box(6, 0.35, 70, 0xc4bdab, 0, 0, 8));

  // reflecting pools on both sides of the path
  for (const sx of [-1, 1]) {
    root.add(box(14, 0.5, 9, 0xf0ebe0, sx * 12, 0, 12));
    const water = new THREE.Mesh(new THREE.BoxGeometry(12.6, 0.2, 7.6), new THREE.MeshToonMaterial({ color: 0x6bb7c9, gradientMap: toonRamp() }));
    water.position.set(sx * 12, 0.5, 12);
    root.add(water);
  }

  // main pagoda on a three-step terrace
  const t = terrace(36, 30, 3);
  t.group.position.z = -14;
  root.add(t.group);
  const main = hall(18, 14, s, { tiers: s.mainTiers, wallH: 5, double: true });
  main.group.position.set(0, t.height, -14);
  root.add(main.group);
  addSpot(0, t.height + 5.5, -14, 40, 22);
  addSpot(0, t.height + main.height * 0.6, -14, 18, 12);

  // front gate hall
  const gate = hall(26, 9, s, { wallH: 4.6 });
  gate.group.position.set(0, 0.3, 34);
  root.add(gate.group);
  addSpot(0, 6, 34, 26, 26);

  // long side halls
  for (const sx of [-1, 1]) {
    const side = hall(9, 30, s, { wallH: 3.6 });
    side.group.position.set(sx * 27, 0.3, 6);
    root.add(side.group);
    addSpot(sx * 27, 5, 6, 22, 14);
  }

  // side pagodas
  const towers = s.sideTowers === 4 ? [[-24, -22], [24, -22], [-24, 22], [24, 22]] : s.sideTowers === 2 ? [[-24, -22], [24, -22]] : [];
  for (const [x, z] of towers) {
    const tw = hall(7, 7, s, { tiers: Math.max(3, s.mainTiers - 1), wallH: 3.4 });
    tw.group.position.set(x, 0.3, z);
    root.add(tw.group);
    addSpot(x, 4, z, 10, 7);
  }

  // outer wall with a tiled cap
  const wallParts: [number, number, number, number][] = [
    [0, -42, 72, 1.6], [-36, 0, 1.6, 84], [36, 0, 1.6, 84], [-24, 42, 24, 1.6], [24, 42, 24, 1.6],
  ];
  for (const [x, z, w, d] of wallParts) {
    root.add(box(w, 3.4, d, s.wall, x, 0, z));
    root.add(box(w + 1, 0.6, d + 1, s.roof, x, 3.4, z));
    addSpot(x, 3.9, z, Math.round(Math.max(w, d) / 6), Math.max(w, d) * 0.9);
  }

  // clan banners by the gate
  for (const sx of [-1, 1]) {
    root.add(box(0.3, 9, 0.3, 0x3a2c22, sx * 16, 0, 44));
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 5), toon(s.banner, THREE.DoubleSide));
    flag.position.set(sx * 16 + 1.3, 6, 44);
    root.add(flag);
  }

  // trees: a ring outside the walls, a few inside the courtyard corners
  const spots: THREE.Vector3[] = [];
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2, r = 46 + rand() * 50;
    spots.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  for (const [x, z] of [[-30, -36], [30, -36], [-20, 24], [20, 24], [-30, 36], [30, 36]]) spots.push(new THREE.Vector3(x, 0.3, z));
  root.add(greenery(rand, s, spots, roofSpots));

  root.add(mountains(rand));

  // drifting mist
  const tex = softTexture();
  const mist = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xf6f0e4, transparent: true, opacity: 0.4, depthWrite: false }));
    const a = rand() * Math.PI * 2, r = 130 + rand() * 120;
    sp.position.set(Math.cos(a) * r, 10 + rand() * 25, Math.sin(a) * r);
    sp.scale.setScalar(60 + rand() * 60);
    mist.add(sp);
  }
  root.add(mist);

  return { root, style: s, mist };
}
