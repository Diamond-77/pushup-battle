import * as THREE from "three";
import type { Box } from "../palace/arasaka";

// Neon Bamboo Row: the street that runs from the citadel's front gate out into the hills.
// A wet black road that shines with the colours of the signs, raised pavements, pagoda shophouses
// with stacked neon screens, strings of lanterns over the road, street lamps, and bamboo groves
// glowing green behind the shops.

export const STREET = { x: 14, z0: 86, z1: 232 }; // the street's half width (to the shop fronts) and its length

const SHOPS = ["RAMEN", "IRON GYM", "TEA HOUSE", "PROTEIN", "NOODLES", "ARCADE", "DOJO SUPPLY", "BAMBOO BATH", "DUMPLINGS", "STRENGTH", "SMOOTHIES", "MASSAGE", "BOBA", "SUSHI", "RUN CLUB", "HOT POT"];
const VERT = ["OPEN", "PUSH", "FRESH", "24 H", "SALE", "HOT", "LIVE", "NEW"];
const COLORS = ["#3dff7a", "#00e5ff", "#ff2fa0", "#ffd23a", "#3dff7a", "#a66bff", "#ff5a3a", "#2fd0ff"];

const tex = (w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

function signTex(text: string, color: string, vertical: boolean) {
  return vertical
    ? tex(128, 512, (g, w, h) => {
        g.fillStyle = "#06070a"; g.fillRect(0, 0, w, h);
        g.strokeStyle = color; g.lineWidth = 8; g.shadowColor = color; g.shadowBlur = 18; g.strokeRect(8, 8, w - 16, h - 16);
        const ls = [...text.replace(/ /g, "")], step = Math.min(80, (h - 60) / ls.length);
        g.font = `bold ${Math.round(step * 0.88)}px Inter, Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
        ls.forEach((ch, i) => { const y = h / 2 - (step * (ls.length - 1)) / 2 + i * step; g.shadowBlur = 22; g.fillStyle = color; g.fillText(ch, w / 2, y); g.shadowBlur = 0; g.fillStyle = "rgba(255,255,255,0.85)"; g.fillText(ch, w / 2, y); });
      })
    : tex(512, 128, (g, w, h) => {
        g.fillStyle = "#06070a"; g.fillRect(0, 0, w, h);
        g.strokeStyle = color; g.lineWidth = 7; g.shadowColor = color; g.shadowBlur = 16; g.strokeRect(8, 8, w - 16, h - 16);
        g.font = "bold 64px Inter, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        g.shadowBlur = 24; g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 2, w - 40);
        g.shadowBlur = 0; g.fillStyle = "rgba(255,255,255,0.85)"; g.fillText(text, w / 2, h / 2 + 2, w - 40);
      });
}

// a soft streak of colour lying on the wet road, as if a sign above were reflected in it
const streakTex = tex(64, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "rgba(255,255,255,0)");
  gr.addColorStop(0.3, "rgba(255,255,255,0.55)");
  gr.addColorStop(0.55, "rgba(255,255,255,0.8)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  const side = g.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, "rgba(0,0,0,1)");
  side.addColorStop(0.5, "rgba(0,0,0,0)");
  side.addColorStop(1, "rgba(0,0,0,1)");
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = side;
  g.fillRect(0, 0, w, h);
  // broken up by ripples
  for (let y = 0; y < h; y += 6) { g.fillStyle = `rgba(0,0,0,${0.25 + Math.random() * 0.4})`; g.fillRect(0, y, w, 2); }
});

export function buildStreet() {
  const root = new THREE.Group();
  const solid: Box[] = [], walk: Box[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const { x: HX, z0, z1 } = STREET, L = z1 - z0, zc = (z0 + z1) / 2;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    root.add(m);
    return m;
  };
  const basic = (color: string | number) => new THREE.MeshBasicMaterial({ color, toneMapped: false });

  // the wet road: near-black and glossy, with puddles that shine brighter
  const roadTex = tex(256, 1024, (g, w, h) => {
    g.fillStyle = "#121418"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${rand() < 0.5 ? "255,255,255" : "0,0,0"},${0.03 + rand() * 0.05})`; g.fillRect(rand() * w, rand() * h, 2, 2); }
    for (let i = 0; i < 40; i++) { g.fillStyle = "rgba(60,80,100,0.35)"; g.beginPath(); g.ellipse(rand() * w, rand() * h, 10 + rand() * 30, 20 + rand() * 60, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = "rgba(255,210,80,0.5)";
    for (let y = 0; y < h; y += 64) g.fillRect(w / 2 - 3, y, 6, 34); // dashed centre line
  });
  roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(1, L / 40);
  const road = new THREE.MeshPhongMaterial({ map: roadTex, color: 0xffffff, shininess: 120, specular: 0x8899aa, emissive: 0x05070a });
  const rw = 2 * (HX - 4.5);
  add(new THREE.PlaneGeometry(rw, L).rotateX(-Math.PI / 2), road, 0, 0.04, zc);
  // pavements either side, a step up
  const pave = new THREE.MeshPhongMaterial({ color: 0x2a2c31, shininess: 60, specular: 0x333844 });
  const curb = basic("#3dff7a");
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(4.5, 0.2, L), pave, s * (HX - 2.25), 0.1, zc);
    add(new THREE.BoxGeometry(0.06, 0.06, L), curb, s * (rw / 2 + 0.03), 0.2, zc); // a thin green glow along the kerb
    walk.push({ x0: s > 0 ? rw / 2 : -HX, x1: s > 0 ? HX : -rw / 2, z0, z1, y0: 0, y1: 0.2 });
  }

  // gateway arch at the citadel end
  const ironM = new THREE.MeshPhongMaterial({ color: 0x15161b, shininess: 40 });
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(1, 9, 1), ironM, s * (HX - 1), 4.5, z0 + 6);
    solid.push({ x0: s * (HX - 1) - 0.5, x1: s * (HX - 1) + 0.5, z0: z0 + 5.5, z1: z0 + 6.5, y0: 0, y1: 9 });
  }
  add(new THREE.BoxGeometry(2 * HX + 2, 0.8, 1.4), ironM, 0, 9.2, z0 + 6);
  add(new THREE.PlaneGeometry(14, 1.8), new THREE.MeshBasicMaterial({ map: signTex("NEON BAMBOO ROW", "#3dff7a", false), toneMapped: false }), 0, 7.8, z0 + 6.75, Math.PI);
  add(new THREE.PlaneGeometry(14, 1.8), new THREE.MeshBasicMaterial({ map: signTex("NEON BAMBOO ROW", "#3dff7a", false), toneMapped: false }), 0, 7.8, z0 + 5.25);

  // shophouses down both sides
  const body = new THREE.MeshLambertMaterial({ color: 0x1a1517 });
  const roofM = new THREE.MeshLambertMaterial({ color: 0x23262e });
  const winWarm = basic("#ffb35a"), winGreen = basic("#9dffb8"), winPink = basic("#ff8ad0");
  const streakMats = new Map<string, THREE.Material>();
  const streak = (color: string) => {
    if (!streakMats.has(color)) streakMats.set(color, new THREE.MeshBasicMaterial({ map: streakTex, color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    return streakMats.get(color)!;
  };
  const streakGeo = new THREE.PlaneGeometry(2.4, 12).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
  let k = 0;
  for (const s of [-1, 1]) {
    for (let z = z0 + 14; z < z1 - 6; z += 15) {
      const W = 12, D = 9, floors = 2 + Math.floor(rand() * 2), fh = 3.6, H = floors * fh;
      const x = s * (HX + D / 2), color = COLORS[k % COLORS.length];
      const front = s * HX; // the face toward the road
      const face = s > 0 ? -Math.PI / 2 : Math.PI / 2; // planes face the road
      add(new THREE.BoxGeometry(D, H, W), body, x, H / 2, z);
      solid.push({ x0: x - D / 2, x1: x + D / 2, z0: z - W / 2, z1: z + W / 2, y0: 0, y1: H });
      // lit windows and a glowing shop front
      add(new THREE.PlaneGeometry(W - 3, 2.4), [winWarm, winGreen, winPink][k % 3], front - s * 0.02, 1.4, z, face);
      for (let f = 1; f < floors; f++) for (const dz of [-3, 0, 3]) if (rand() < 0.75) add(new THREE.PlaneGeometry(2, 1.6), rand() < 0.5 ? winWarm : winGreen, front - s * 0.02, f * fh + 1.6, z + dz, face);
      // flared roofs, one per storey, with a neon edge
      for (let f = 1; f <= floors; f++) {
        const top = f === floors, r = (top ? 1.15 : 1.05) * Math.hypot(D, W) / 2;
        const roof = add(new THREE.ConeGeometry(r, top ? 3 : 1.2, 4, 1, !top), roofM, x, f * fh + (top ? 1.5 : 0.2), z);
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(D / Math.hypot(D, W) * 1.45, 1, W / Math.hypot(D, W) * 1.45);
        add(new THREE.BoxGeometry(0.08, 0.08, W + 1.6), basic(color), front - s * 1.0, f * fh - 0.35, z);
      }
      // the shop's sign over the door, and a vertical neon screen sticking out over the pavement
      add(new THREE.PlaneGeometry(6.5, 1.6), new THREE.MeshBasicMaterial({ map: signTex(SHOPS[k % SHOPS.length], color, false), toneMapped: false }), front - s * 0.05, 3.1, z, face);
      const vColor = COLORS[(k * 3 + 1) % COLORS.length];
      const vMat = new THREE.MeshBasicMaterial({ map: signTex(VERT[k % VERT.length], vColor, true), toneMapped: false, side: THREE.DoubleSide });
      add(new THREE.BoxGeometry(1.7, 6.2, 0.2), ironM, front - s * 1.0, 5.6, z + W / 2 - 1.2);
      add(new THREE.PlaneGeometry(1.5, 6), vMat, front - s * 1.0, 5.6, z + W / 2 - 1.08);
      add(new THREE.PlaneGeometry(1.5, 6), vMat, front - s * 1.0, 5.6, z + W / 2 - 1.32, Math.PI);
      // their reflections in the wet road
      add(streakGeo, streak(color), s * (rw / 2 - 2), 0.06, z);
      add(streakGeo, streak(vColor), s * (rw / 2 - 2.4), 0.07, z + W / 2 - 1.2);
      k++;
    }
  }

  // street lamps along the kerbs, and strings of lanterns across the road
  const lampHead = basic("#d8fff0"), pole = new THREE.CylinderGeometry(0.08, 0.1, 6, 6);
  const lanternR = basic("#ff3b4a"), lanternG = basic("#3dff7a"), wire = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const lanternGeo = new THREE.SphereGeometry(0.32, 10, 8);
  for (let z = z0 + 10; z < z1; z += 12) {
    for (const s of [-1, 1]) {
      add(pole, ironM, s * (rw / 2 + 0.6), 3, z);
      add(new THREE.BoxGeometry(1.4, 0.15, 0.3), lampHead, s * (rw / 2 - 0.1), 6, z);
      add(streakGeo, streak("#bfffe8"), s * (rw / 2 - 1.2), 0.065, z);
    }
    if (((z - z0) / 12) % 2 === 1) {
      const span = 2 * (HX + 0.5);
      const w = add(new THREE.CylinderGeometry(0.02, 0.02, span, 4), wire, 0, 6.6, z + 6);
      w.rotation.z = Math.PI / 2;
      for (let i = 0; i < 9; i++) {
        const x = -span / 2 + ((i + 0.5) * span) / 9, sag = 0.8 * (1 - Math.pow((2 * x) / span, 2));
        add(lanternGeo, i % 2 ? lanternG : lanternR, x, 6.1 - sag, z + 6).scale.set(1, 1.3, 1);
      }
    }
  }

  // bamboo: tall jointed stalks in groves behind and between the shops, lit green from below
  const stalk = new THREE.CylinderGeometry(0.09, 0.12, 1, 6);
  stalk.translate(0, 0.5, 0);
  const bamboo = new THREE.MeshLambertMaterial({ color: 0x4f9a3c, emissive: 0x0e4a1a });
  const leaf = new THREE.ConeGeometry(0.9, 2.6, 5);
  const leafM = new THREE.MeshLambertMaterial({ color: 0x3f8a32, emissive: 0x0b3a14 });
  const spots: [number, number, number][] = [];
  for (let i = 0; i < 900; i++) {
    const s = rand() < 0.5 ? -1 : 1;
    const z = z0 + 4 + rand() * (L - 8);
    // behind the shops, or in the 3 m gaps between them
    const gap = (((z - z0 - 20) % 15) + 15) % 15 < 3;
    const x = s * (gap ? HX + 0.8 + rand() * 9 : HX + 9.5 + rand() * 14);
    spots.push([x, z, 7 + rand() * 9]);
  }
  const stalks = new THREE.InstancedMesh(stalk, bamboo, spots.length);
  const leaves = new THREE.InstancedMesh(leaf, leafM, spots.length * 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  spots.forEach(([x, z, h], i) => {
    e.set((rand() - 0.5) * 0.12, 0, (rand() - 0.5) * 0.12);
    stalks.setMatrixAt(i, m4.compose(v.set(x, 0, z), q.setFromEuler(e), sc.set(1, h, 1)));
    for (let j = 0; j < 2; j++) {
      e.set((rand() - 0.5) * 1.2, rand() * 6, (rand() - 0.5) * 1.2);
      leaves.setMatrixAt(i * 2 + j, m4.compose(v.set(x + (rand() - 0.5), h - 1 - j * 2.2, z + (rand() - 0.5)), q.setFromEuler(e), sc.set(0.8, 1, 0.5)));
    }
  });
  root.add(stalks, leaves);
  // a green glow on the ground under the groves
  const glow = tex(64, 64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, "rgba(61,255,122,0.5)");
    r.addColorStop(1, "rgba(61,255,122,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
  const glowM = new THREE.MeshBasicMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  for (let z = z0 + 10; z < z1; z += 16) for (const s of [-1, 1]) add(new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2), glowM, s * (HX + 16), 0.08, z);

  // signs flicker now and then
  const flick = [...streakMats.values()] as THREE.MeshBasicMaterial[];
  function tick(t: number) {
    flick.forEach((m, i) => { m.opacity = 0.8 + 0.1 * Math.sin(t * 2 + i) + (Math.sin(t * 31 + i * 7) > 0.995 ? -0.4 : 0); });
  }
  return { root, solid, walk, tick };
}
