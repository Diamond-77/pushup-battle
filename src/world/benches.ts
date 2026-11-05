import * as THREE from "three";
import { toon } from "../palace/buildPalace";
import type { Box } from "../palace/arasaka";

// Six rows of benches in front of the giant screen, an aisle down the middle.
// Each row is its own little group: people sitting in the same row can chat.

export type Seat = { i: number; row: number; pos: THREE.Vector3; facing: number };

const ROWS = 6, GAP = 1.1, SEAT_H = 0.5;

// base: the foot of the screen; ry: which way the screen faces
export function buildBenches(base: THREE.Vector3, ry: number) {
  const root = new THREE.Group();
  const seats: Seat[] = [];
  const walk: Box[] = [];
  const wood = toon(0x2a1c16), iron = toon(0x1d1c22), cushion = toon(0x7e1c17);
  const n = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)); // out from the screen
  const u = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry)); // along the rows
  const facing = Math.atan2(-n.x, -n.z); // sitting, you look at the screen
  const seatGeo = new THREE.BoxGeometry(1, 0.12, 0.55), cushGeo = new THREE.BoxGeometry(1, 0.06, 0.45), backGeo = new THREE.BoxGeometry(1, 0.5, 0.08), legGeo = new THREE.BoxGeometry(0.1, SEAT_H - 0.06, 0.45);
  for (let r = 0; r < ROWS; r++) {
    const d = 13 + r * 2.6, len = 6 + r * 0.6, n0 = Math.round(len / GAP);
    for (const side of [-1, 1]) {
      const c = base.clone().addScaledVector(n, d).addScaledVector(u, side * (1.1 + len / 2));
      const bench = new THREE.Group();
      bench.position.copy(c);
      bench.rotation.y = ry;
      const L = n0 * GAP;
      const seat = new THREE.Mesh(seatGeo, wood);
      seat.scale.x = L;
      seat.position.y = SEAT_H - 0.06;
      const cush = new THREE.Mesh(cushGeo, cushion);
      cush.scale.x = L - 0.2;
      cush.position.y = SEAT_H + 0.02;
      const back = new THREE.Mesh(backGeo, wood);
      back.scale.x = L;
      back.position.set(0, SEAT_H + 0.3, 0.27); // the backrest is on the side away from the screen
      bench.add(seat, cush, back);
      for (let k = 0; k <= Math.ceil(L / 2.4); k++) {
        const leg = new THREE.Mesh(legGeo, iron);
        leg.position.set(-L / 2 + 0.1 + (k * (L - 0.2)) / Math.ceil(L / 2.4), (SEAT_H - 0.06) / 2, 0);
        bench.add(leg);
      }
      root.add(bench);
      for (let k = 0; k < n0; k++) {
        const along = -L / 2 + GAP / 2 + k * GAP;
        const p = c.clone().addScaledVector(u, along);
        seats.push({ i: seats.length, row: r, pos: p.clone().setY(base.y), facing }); // feet on the ground, the pose lifts the hips onto the seat
        // you can step up onto a bench, a small box per seat (the rows are turned, boxes are not)
        walk.push({ x0: p.x - 0.42, x1: p.x + 0.42, z0: p.z - 0.42, z1: p.z + 0.42, y0: base.y, y1: base.y + SEAT_H });
      }
    }
  }
  return { root, seats, walk, rows: ROWS };
}
