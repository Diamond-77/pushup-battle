import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { toon } from "./buildPalace";

// Proper trees: a leaning, tapering trunk that splits into branches, each branch ending in clumps of
// foliage. Black pines with flat cloud-pruned needle pads (the classic garden pine), and red maples
// for colour. Everything is merged into one wood mesh and one foliage mesh (vertex coloured) so a
// whole forest is two draw calls.

const up = new THREE.Vector3(0, 1, 0);

function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number) {
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 7, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

// a lumpy clump of leaves, lighter on top, darker underneath
function clump(at: THREE.Vector3, sx: number, sy: number, sz: number, top: THREE.Color, bottom: THREE.Color, rand: () => number) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position, col: number[] = [], c = new THREE.Color(), seed = rand() * 100;
  for (let i = 0; i < p.count; i++) {
    // the lump depends on the vertex position only, so faces sharing a corner stay joined
    const h = Math.sin(p.getX(i) * 12.9898 + p.getY(i) * 78.233 + p.getZ(i) * 37.719 + seed) * 43758.5453;
    const k = 0.82 + (h - Math.floor(h)) * 0.36;
    p.setXYZ(i, p.getX(i) * sx * k, p.getY(i) * sy * k, p.getZ(i) * sz * k);
    c.copy(bottom).lerp(top, THREE.MathUtils.clamp(p.getY(i) / sy * 0.5 + 0.5, 0, 1)).multiplyScalar(0.9 + (h - Math.floor(h)) * 0.2);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.deleteAttribute("uv");
  g.translate(at.x, at.y, at.z);
  g.computeVertexNormals();
  return g;
}

export type TreeSpot = { p: THREE.Vector3; kind: "pine" | "maple" };

export function forest(spots: TreeSpot[], rand: () => number) {
  const wood: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = [];
  const pineTop = new THREE.Color(0x4f8a4a), pineBot = new THREE.Color(0x173a26);
  const mapleTop = new THREE.Color(0xff5a3a), mapleBot = new THREE.Color(0x8a1a1a);
  for (const { p, kind } of spots) {
    const s = 0.8 + rand() * 0.6;
    const lean = new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).multiplyScalar(kind === "pine" ? 1.2 : 0.5);
    // trunk: four bending segments, tapering
    const pts = [p.clone()];
    const H = (kind === "pine" ? 7 : 5.5) * s;
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      pts.push(p.clone().add(new THREE.Vector3(lean.x * t * t * 3 + (rand() - 0.5) * 0.4, H * t, lean.z * t * t * 3 + (rand() - 0.5) * 0.4)));
    }
    const r0 = (kind === "pine" ? 0.42 : 0.46) * s;
    for (let i = 0; i < 4; i++) wood.push(limb(pts[i], pts[i + 1], r0 * (1 - i * 0.2), r0 * (1 - (i + 1) * 0.2)));
    // root flare
    wood.push(limb(p.clone().setY(p.y - 0.2), pts[0].clone().setY(p.y + 0.6), r0 * 1.6, r0));
    // branches from the upper trunk, each ending in foliage
    const nb = kind === "pine" ? 5 : 4;
    for (let b = 0; b < nb; b++) {
      const t = kind === "pine" ? 0.35 + (b / nb) * 0.6 : 0.55 + rand() * 0.35;
      const seg = Math.min(3, Math.floor(t * 4)), from = pts[seg].clone().lerp(pts[seg + 1], t * 4 - seg);
      const ang = (b / nb) * Math.PI * 2 + rand() * 0.8;
      const reach = (kind === "pine" ? 2.6 : 2.2) * s * (kind === "pine" ? 1.15 - t * 0.5 : 1);
      const rise = kind === "pine" ? 0.3 + rand() * 0.6 : 1.2 + rand() * 1.2;
      const mid = from.clone().add(new THREE.Vector3(Math.cos(ang) * reach * 0.55, rise * 0.4, Math.sin(ang) * reach * 0.55));
      const end = from.clone().add(new THREE.Vector3(Math.cos(ang) * reach, rise, Math.sin(ang) * reach));
      const br = r0 * 0.38;
      wood.push(limb(from, mid, br, br * 0.7), limb(mid, end, br * 0.7, br * 0.4));
      if (kind === "pine") {
        // a flat cloud-pruned pad on the branch end, with a smaller one beside it
        leaves.push(clump(end.clone().setY(end.y + 0.35 * s), 1.6 * s, 0.55 * s, 1.4 * s, pineTop, pineBot, rand));
        leaves.push(clump(mid.clone().setY(mid.y + 0.4 * s), 0.9 * s, 0.4 * s, 0.9 * s, pineTop, pineBot, rand));
      } else {
        for (let l = 0; l < 4; l++) leaves.push(clump(end.clone().add(new THREE.Vector3((rand() - 0.5) * 1.4 * s, (rand() - 0.2) * 0.9 * s, (rand() - 0.5) * 1.4 * s)), 1.15 * s, 0.85 * s, 1.15 * s, mapleTop, mapleBot, rand));
      }
    }
    // the crown
    const top = pts[4];
    if (kind === "pine") leaves.push(clump(top.clone().setY(top.y + 0.4 * s), 1.5 * s, 0.7 * s, 1.5 * s, pineTop, pineBot, rand));
    else leaves.push(clump(top.clone().setY(top.y + 0.6 * s), 1.9 * s, 1.3 * s, 1.9 * s, mapleTop, mapleBot, rand));
  }
  const g = new THREE.Group();
  if (wood.length) {
    const w = new THREE.Mesh(mergeGeometries(wood.map((x) => { x.deleteAttribute("uv"); return x; })), toon(0x3a2a22));
    const ink = new THREE.LineSegments(new THREE.EdgesGeometry(w.geometry, 35), new THREE.LineBasicMaterial({ color: 0x0d0b0e }));
    g.add(w, ink);
  }
  if (leaves.length) g.add(new THREE.Mesh(mergeGeometries(leaves), toon(0xffffff, undefined, { vertexColors: true })));
  return g;
}
