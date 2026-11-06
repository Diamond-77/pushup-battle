import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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

// a simple line-art logo for each kind of shop, drawn in the sign's neon colour
function logo(g: CanvasRenderingContext2D, name: string, cx: number, cy: number, r: number) {
  g.save();
  g.translate(cx, cy);
  g.lineWidth = r * 0.12;
  g.lineCap = g.lineJoin = "round";
  const P = (pts: number[][], close = false) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * r, y * r) : g.moveTo(x * r, y * r))); if (close) g.closePath(); g.stroke(); };
  const C = (x: number, y: number, rr: number, a0 = 0, a1 = Math.PI * 2) => { g.beginPath(); g.arc(x * r, y * r, rr * r, a0, a1); g.stroke(); };
  const bowl = () => { g.beginPath(); g.moveTo(-0.8 * r, 0); g.lineTo(0.8 * r, 0); g.arc(0, 0, 0.8 * r, 0, Math.PI); g.stroke(); P([[-0.35, 0.8], [0.35, 0.8]]); };
  const cup = () => { P([[-0.45, -0.6], [-0.35, 0.8], [0.35, 0.8], [0.45, -0.6]], true); };
  switch (name) {
    case "RAMEN": case "NOODLES": bowl(); P([[-0.2, -0.9], [0.5, -0.1]]); P([[0.05, -0.95], [0.75, -0.15]]); for (const x of [-0.4, 0, 0.4]) P([[x, -0.05], [x, -0.4]]); break;
    case "HOT POT": bowl(); for (const x of [-0.35, 0, 0.35]) P([[x, -0.2], [x + 0.12, -0.5], [x, -0.8]]); break;
    case "IRON GYM": P([[-0.55, 0], [0.55, 0]]); for (const x of [-0.75, -0.55, 0.55, 0.75]) P([[x, -0.45], [x, 0.45]]); break;
    case "STRENGTH": C(0, 0.25, 0.55); P([[-0.3, -0.3], [-0.3, -0.75], [0.3, -0.75], [0.3, -0.3]]); break;
    case "TEA HOUSE": cup(); C(0.6, 0.05, 0.25, -Math.PI / 2, Math.PI / 2); P([[-0.15, -0.8], [0, -1], [-0.1, -1.15]]); break;
    case "PROTEIN": P([[-0.4, -0.5], [-0.3, 0.85], [0.3, 0.85], [0.4, -0.5]], true); P([[-0.45, -0.5], [-0.45, -0.75], [0.45, -0.75], [0.45, -0.5]]); P([[-0.3, 0.1], [0.3, 0.1]]); break;
    case "SMOOTHIES": case "BOBA": cup(); P([[0.1, -0.6], [0.35, -1.15]]); if (name === "BOBA") for (const x of [-0.18, 0, 0.18]) C(x, 0.55, 0.08); else P([[-0.4, -0.2], [0.4, -0.2]]); break;
    case "ARCADE": g.strokeRect(-0.8 * r, -0.2 * r, 1.6 * r, 0.8 * r); P([[-0.4, -0.2], [-0.4, -0.8]]); C(-0.4, -0.85, 0.15); C(0.35, 0.2, 0.12); C(0.6, 0.2, 0.12); break;
    case "DOJO SUPPLY": P([[-0.7, -0.4], [0.7, -0.4]]); P([[-0.5, -0.4], [-0.5, 0.9]]); P([[0.5, -0.4], [0.5, 0.9]]); P([[-0.85, -0.75], [0.85, -0.75]]); break;
    case "BAMBOO BATH": for (const y of [-0.4, 0.05, 0.5]) P([[-0.8, y], [-0.4, y - 0.2], [0, y], [0.4, y - 0.2], [0.8, y]]); break;
    case "DUMPLINGS": g.beginPath(); g.moveTo(-0.8 * r, 0.4 * r); g.quadraticCurveTo(0, -1.0 * r, 0.8 * r, 0.4 * r); g.closePath(); g.stroke(); for (const x of [-0.3, 0, 0.3]) P([[x, -0.25], [x + 0.08, 0.05]]); break;
    case "MASSAGE": C(0, -0.45, 0.3); P([[-0.7, 0.3], [-0.2, 0], [0.2, 0], [0.7, 0.3]]); P([[-0.7, 0.75], [0.7, 0.75]]); break;
    case "SUSHI": g.strokeRect(-0.75 * r, -0.15 * r, 1.5 * r, 0.6 * r); P([[-0.75, -0.15], [-0.5, -0.5], [0.5, -0.5], [0.75, -0.15]]); break;
    case "RUN CLUB": P([[-0.8, 0.5], [0.7, 0.5], [0.8, 0.2], [0.2, 0.05], [-0.1, -0.5], [-0.6, -0.5], [-0.8, 0.5]]); for (const x of [-0.05, 0.15, 0.35]) P([[x, -0.05], [x + 0.12, 0.15]]); break;
    default: C(0, 0, 0.7);
  }
  g.restore();
}

function signTex(text: string, color: string, vertical: boolean, withLogo = false) {
  return vertical
    ? tex(128, 512, (g, w, h) => {
        g.fillStyle = "#06070a"; g.fillRect(0, 0, w, h);
        g.strokeStyle = color; g.lineWidth = 8; g.shadowColor = color; g.shadowBlur = 18; g.strokeRect(8, 8, w - 16, h - 16);
        const ls = [...text.replace(/ /g, "")], step = Math.min(80, (h - 60) / ls.length);
        g.font = `bold ${Math.round(step * 0.88)}px Inter, Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
        ls.forEach((ch, i) => { const y = h / 2 - (step * (ls.length - 1)) / 2 + i * step; g.shadowBlur = 22; g.fillStyle = color; g.fillText(ch, w / 2, y); g.shadowBlur = 0; g.fillStyle = "rgba(255,255,255,0.85)"; g.fillText(ch, w / 2, y); });
      })
    : tex(1024, 256, (g, w, h) => {
        const bg = g.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, "#0b0d14"); bg.addColorStop(1, "#05060a");
        g.fillStyle = bg; g.fillRect(0, 0, w, h);
        g.strokeStyle = color; g.lineWidth = 10; g.shadowColor = color; g.shadowBlur = 24; g.strokeRect(12, 12, w - 24, h - 24);
        g.lineWidth = 3; g.strokeRect(28, 28, w - 56, h - 56);
        const tx = withLogo ? w / 2 + 90 : w / 2;
        if (withLogo) {
          // the logo in a ring at the left
          g.strokeStyle = color; g.shadowBlur = 20; g.lineWidth = 6;
          g.beginPath(); g.arc(150, h / 2, 82, 0, Math.PI * 2); g.stroke();
          g.strokeStyle = "#fff"; g.shadowBlur = 14;
          logo(g, text, 150, h / 2, 50);
          g.strokeStyle = color;
          logo(g, text, 150, h / 2, 50);
        }
        g.font = "bold 118px Inter, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        g.shadowBlur = 30; g.fillStyle = color; g.fillText(text, tx, h / 2 + 4, w - (withLogo ? 300 : 80));
        g.shadowBlur = 0; g.fillStyle = "rgba(255,255,255,0.9)"; g.fillText(text, tx, h / 2 + 4, w - (withLogo ? 300 : 80));
      });
}

// two-tone stripes for an awning
function stripeTex(color: string) {
  const t = tex(64, 64, (g, w, h) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#14121a" : color; g.fillRect(0, (i * h) / 8, w, h / 8); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 3);
  return t;
}

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
  const road = new THREE.MeshPhongMaterial({
    map: roadTex, color: 0xb8c0cc, shininess: 140, specular: 0x9aaabb, emissive: 0x020304,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
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

  // shophouses down both sides: built in each shop's own frame (x out toward the road, z along it),
  // then merged by material so the whole row costs a handful of draw calls; ink outlines on the edges
  const body = new THREE.MeshLambertMaterial({ color: 0x1d181b });
  const plaster = new THREE.MeshLambertMaterial({ color: 0x2b2427 });
  const roofM = new THREE.MeshLambertMaterial({ color: 0x262a33 });
  const frameM = new THREE.MeshLambertMaterial({ color: 0x0f0d10 });
  const postM = new THREE.MeshLambertMaterial({ color: 0x7e1c17 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x4a4e57 });
  const winWarm = basic("#ffb35a"), winGreen = basic("#9dffb8"), winPink = basic("#ff8ad0"), winCyan = basic("#8ef3ff"), winDark = basic("#14161c");
  const awnings = COLORS.map((c) => new THREE.MeshLambertMaterial({ map: stripeTex(c), emissive: new THREE.Color(c).multiplyScalar(0.25) }));
  const norenM = [basic("#2a1f5a"), basic("#5a1018"), basic("#0f3a2a")];
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const lines: THREE.BufferGeometry[] = [];
  const P = (mat: THREE.Material, geo: THREE.BufferGeometry, m: THREE.Matrix4, outline = false) => {
    geo.applyMatrix4(m);
    if (!parts.has(mat)) parts.set(mat, []);
    parts.get(mat)!.push(geo);
    if (outline) lines.push(new THREE.EdgesGeometry(geo, 30));
  };
  const at = (base: THREE.Matrix4, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  let k = 0;
  for (const s of [-1, 1]) {
    for (let z = z0 + 14; z < z1 - 6; z += 15) {
      const W = 12, D = 9, floors = 2 + Math.floor(rand() * 2), fh = 3.6, H = floors * fh;
      const color = COLORS[k % COLORS.length], name = SHOPS[k % SHOPS.length];
      const front = s * HX;
      const base = new THREE.Matrix4().compose(new THREE.Vector3(front, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s > 0 ? Math.PI : 0), new THREE.Vector3(1, 1, 1));
      const B = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, zz: number, outline = false, rz = 0) => P(mat, new THREE.BoxGeometry(d, h, w), at(base, x, y + h / 2, zz, 0, 0, rz), outline);
      const face = (mat: THREE.Material, w: number, h: number, x: number, y: number, zz: number) => P(mat, new THREE.PlaneGeometry(w, h).rotateY(Math.PI / 2), at(base, x, y + h / 2, zz));
      // the building and a plaster band between storeys
      B(body, W, H, D, -D / 2, 0, 0, true);
      solid.push({ x0: Math.min(front, front - s * D), x1: Math.max(front, front - s * D), z0: z - W / 2, z1: z + W / 2, y0: 0, y1: H });
      for (let f = 1; f < floors; f++) B(plaster, W + 0.2, 0.35, 0.3, 0.05, f * fh - 0.2, 0, true);
      // ground floor: a lit shop window between two red posts, mullions, a noren curtain over the door
      face([winWarm, winGreen, winPink, winCyan][k % 4], W - 2.6, 2.6, 0.02, 0.25, 0);
      for (let m = -2; m <= 2; m++) B(frameM, 0.1, 2.6, 0.12, 0.06, 0.25, m * ((W - 2.6) / 5));
      B(frameM, W - 2.4, 0.18, 0.2, 0.06, 2.85, 0);
      B(frameM, W - 2.4, 0.25, 0.25, 0.06, 0, 0);
      for (const sz of [-1, 1]) B(postM, 0.42, 3.4, 0.42, 0.25, 0, sz * (W / 2 - 0.6), true);
      for (let n = 0; n < 4; n++) face(norenM[k % 3], 0.55, 0.75, 0.3, 2.05, -0.9 + n * 0.6);
      // a striped awning sloping out over the pavement
      P(awnings[k % awnings.length], new THREE.BoxGeometry(1.8, 0.1, W - 0.6), at(base, 0.9, 3.3, 0, 0, 0, -0.32), true);
      // the shop sign: a lit box with the shop's logo and name
      B(frameM, 6.8, 1.7, 0.35, 0.18, 3.75, 0, true);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 1.5), new THREE.MeshBasicMaterial({ map: signTex(name, color, false, true), toneMapped: false }));
      sign.applyMatrix4(at(base, 0.37, 3.85 + 0.75, 0, 0, Math.PI / 2));
      root.add(sign);
      // upper floors: framed windows with cross bars, the odd one dark, air conditioners, a balcony
      for (let f = 1; f < floors; f++) for (const dz of [-3.6, 0, 3.6]) {
        const y = f * fh + 0.9, lit = rand() < 0.8;
        B(frameM, 2.3, 1.9, 0.16, 0.06, y - 0.15, dz, true);
        face(lit ? (rand() < 0.5 ? winWarm : rand() < 0.5 ? winGreen : winCyan) : winDark, 2, 1.6, 0.15, y, dz);
        B(frameM, 0.06, 1.6, 0.05, 0.16, y, dz);
        B(frameM, 2, 0.06, 0.05, 0.16, y + 0.8, dz);
        if (rand() < 0.4) { B(metal, 0.9, 0.6, 0.5, 0.3, y - 0.85, dz + 0.5, true); face(frameM, 0.5, 0.4, 0.56, y - 0.75, dz + 0.5); }
      }
      if (floors > 2 && rand() < 0.7) {
        B(plaster, W - 2, 0.15, 1.1, 0.55, fh, 0, true);
        for (let b = 0; b <= 12; b++) B(frameM, 0.05, 0.9, 0.05, 1.05, fh + 0.15, -(W - 2) / 2 + (b * (W - 2)) / 12);
        B(postM, W - 2, 0.08, 0.08, 1.05, fh + 1.05, 0);
      }
      // a drainpipe and a neon line under each roof tier
      P(metal, new THREE.CylinderGeometry(0.08, 0.08, H, 6), at(base, 0.12, H / 2, W / 2 - 0.3));
      // flared roofs, one per storey
      for (let f = 1; f <= floors; f++) {
        const top = f === floors, r = (top ? 1.15 : 1.05) * Math.hypot(D, W) / 2;
        const g = new THREE.ConeGeometry(r, top ? 3 : 1.2, 4, 1, !top).rotateY(Math.PI / 4).scale(D / Math.hypot(D, W) * 1.45, 1, W / Math.hypot(D, W) * 1.45);
        P(roofM, g, at(base, -D / 2, f * fh + (top ? 1.5 : 0.2), 0), true);
        P(basic(color), new THREE.BoxGeometry(0.08, 0.08, W + 0.4), at(base, 0.95, f * fh - 0.35, 0));
        if (top) for (const sz of [-1, 1]) P(roofM, new THREE.ConeGeometry(0.25, 1.4, 4), at(base, -D / 2, f * fh + 3.2, sz * 2.2, 0, 0, sz * 0.4), true);
      }
      // a pair of red lanterns by the door
      for (const sz of [-1, 1]) P(basic("#ff3b4a"), new THREE.SphereGeometry(0.28, 10, 8).scale(1, 1.3, 1), at(base, 0.55, 2.6, sz * (W / 2 - 1.3)));
      // a vertical neon screen sticking out over the pavement (two planes back to back)
      const vColor = COLORS[(k * 3 + 1) % COLORS.length];
      const vMat = new THREE.MeshBasicMaterial({ map: signTex(VERT[k % VERT.length], vColor, true), toneMapped: false });
      B(frameM, 0.2, 6.2, 1.7, 1.0, 2.5, W / 2 - 1.2, true);
      for (const back of [0, 1]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 6), vMat);
        m.applyMatrix4(at(base, 1.0, 5.6, W / 2 - 1.2 + (back ? -0.11 : 0.11), 0, back ? Math.PI : 0));
        root.add(m);
      }
      k++;
    }
  }
  for (const [mat, geos] of parts) root.add(new THREE.Mesh(mergeGeometries(geos), mat));
  root.add(new THREE.LineSegments(mergeGeometries(lines), new THREE.LineBasicMaterial({ color: 0x050406 })));

  // street lamps along the kerbs, and strings of lanterns across the road
  const lampHead = basic("#d8fff0"), pole = new THREE.CylinderGeometry(0.08, 0.1, 6, 6);
  const lanternR = basic("#ff3b4a"), lanternG = basic("#3dff7a"), wire = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const lanternGeo = new THREE.SphereGeometry(0.32, 10, 8);
  for (let z = z0 + 10; z < z1; z += 12) {
    for (const s of [-1, 1]) {
      add(pole, ironM, s * (rw / 2 + 0.6), 3, z);
      add(new THREE.BoxGeometry(1.4, 0.15, 0.3), lampHead, s * (rw / 2 - 0.1), 6, z);
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
    const z = z0 + 10 + rand() * (L - 14); // (clear of the train platforms at the street's end)
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

  // the wet road: everything that glows is mirrored under it and seen through it where the road shows
  // (a stencil the road writes), so the signs, windows and lanterns shine in the puddles
  const mirror = new THREE.Group();
  const mirrorMats = new Map<THREE.Material, THREE.Material>();
  const flip = new THREE.Matrix4().makeTranslation(0, 2 * 0.04, 0).multiply(new THREE.Matrix4().makeScale(1, -1, 1));
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !(m.material instanceof THREE.MeshBasicMaterial) || m.material.transparent) return;
    if (!mirrorMats.has(m.material)) {
      const src = m.material;
      mirrorMats.set(src, new THREE.MeshBasicMaterial({
        color: src.color, map: src.map, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilWriteMask: 0,
        stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp,
      }));
    }
    const r = new THREE.Mesh(m.geometry, mirrorMats.get(m.material)!);
    r.matrixAutoUpdate = false;
    r.matrix.copy(flip).multiply(m.matrixWorld);
    r.renderOrder = 5;
    mirror.add(r);
  });
  root.add(mirror);
  function tick() {}
  return { root, solid, walk, tick };
}
