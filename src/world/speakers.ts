import * as THREE from "three";
import type { Box } from "../palace/arasaka";

// Arasaka sound system round the giant screen: two speakers on the screen's top, tall speaker stacks at
// its feet and speakers on poles beside the benches. Gloss-black cabinets, woofers ringed in red light
// that pulse while a song plays. The music is loudest next to a speaker.

export function buildSpeakers(base: THREE.Vector3, ry: number) {
  const root = new THREE.Group();
  const points: THREE.Vector3[] = [];
  const solid: Box[] = [];
  const rings: THREE.Mesh[] = [];
  const n = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)); // out from the screen
  const u = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry)); // along it
  const body = new THREE.MeshPhongMaterial({ color: 0x0c0c10, shininess: 90, specular: 0x444455 });
  const cone = new THREE.MeshPhongMaterial({ color: 0x1b1b22, shininess: 20 });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false });
  const strip = new THREE.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false });
  const ringGeo = new THREE.TorusGeometry(1, 0.08, 6, 24), coneGeo = new THREE.CylinderGeometry(1, 0.55, 0.25, 20);

  // one cabinet w x h, woofers stacked up its front; tilt = leaning down toward the crowd
  const cabinet = (w: number, h: number, d: number, tilt = 0) => {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), body);
    b.position.y = h / 2;
    g.add(b);
    const k = Math.max(1, Math.round(h / w));
    const r = Math.min(w, h / k) * 0.36;
    for (let i = 0; i < k; i++) {
      const y = (h / k) * (i + 0.5);
      const c = new THREE.Mesh(coneGeo, cone);
      c.rotation.x = Math.PI / 2;
      c.scale.setScalar(r);
      c.position.set(0, y, d / 2 + 0.02);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.scale.setScalar(r * 1.08);
      ring.position.set(0, y, d / 2 + 0.06);
      g.add(c, ring);
      rings.push(ring);
    }
    const s = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.08, 0.04), strip);
    s.position.set(0, h - 0.15, d / 2 + 0.03);
    g.add(s);
    g.rotation.x = tilt;
    return g;
  };
  const place = (g: THREE.Object3D, along: number, out: number, y: number, turn = 0) => {
    const p = base.clone().addScaledVector(u, along).addScaledVector(n, out);
    p.y = base.y + y;
    g.position.copy(p);
    g.rotation.y = ry + turn;
    root.add(g);
    return p;
  };

  // on top of the screen, leaning down at the benches
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.add(cabinet(2.4, 3.6, 2, 0.35));
    points.push(place(g, s * 14, -0.2, 29.6, -s * 0.25).setY(base.y + 31));
  }
  // tall stacks at its feet
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) { const c = cabinet(2.6, 2.4, 2); c.position.y = i * 2.45; g.add(c); }
    const top = cabinet(2.2, 1.6, 1.6, 0.2); top.position.y = 7.35; g.add(top);
    const p = place(g, s * 21.5, 1.4, 0, -s * 0.35);
    points.push(p.clone().setY(base.y + 4));
    solid.push({ x0: p.x - 1.8, x1: p.x + 1.8, z0: p.z - 1.8, z1: p.z + 1.8, y0: base.y, y1: base.y + 9 });
  }
  // on poles beside the benches
  const pole = new THREE.CylinderGeometry(0.14, 0.18, 5, 8);
  for (const s of [-1, 1]) for (const out of [15, 25]) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(pole, body);
    m.position.y = 2.5;
    g.add(m);
    const c = cabinet(1.2, 1.8, 1, 0.25); c.position.y = 5; g.add(c);
    const p = place(g, s * 13.5, out, 0, Math.PI - s * 0.5);
    points.push(p.clone().setY(base.y + 5.8));
    solid.push({ x0: p.x - 0.3, x1: p.x + 0.3, z0: p.z - 0.3, z1: p.z + 0.3, y0: base.y, y1: base.y + 5 });
  }

  // the red rings breathe with the music
  function tick(t: number, playing: boolean) {
    const k = playing ? 1 + 0.06 * Math.max(0, Math.sin(t * 13)) * Math.abs(Math.sin(t * 2.1)) : 1;
    for (const r of rings) r.scale.setScalar(r.userData.s ?? (r.userData.s = r.scale.x)).multiplyScalar(k);
    ringMat.color.setHex(playing ? 0xff2a3a : 0xa01822);
  }

  // how loud the music is at p: full right by a speaker, fading over ~45 m, never quite silent near the screen
  const loudAt = (p: THREE.Vector3) => {
    let best = 0;
    for (const q of points) best = Math.max(best, Math.pow(THREE.MathUtils.clamp(1 - (p.distanceTo(q) - 3) / 45, 0, 1), 1.4));
    return best;
  };
  return { root, solid, tick, loudAt };
}
