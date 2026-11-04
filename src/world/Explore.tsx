import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { buildArasaka, groundAt, ARASAKA_SPAWN, type Box } from "../palace/arasaka";
import { skyTexture } from "../palace/buildPalace";
import { ENVS } from "../palace/weather";
import { clanById } from "../clans";
import ClanLogo from "../ClanLogo";
import { Hero } from "./hero";

// Walk around the Arasaka citadel in third person.
// Left thumb: the round joystick (push further to run). Right thumb: drag to turn the camera.
// On a computer: WASD or arrow keys, Shift to run, drag to look. Doors open as you walk up to them.

const R = 0.38; // body radius
const TALL = 1.7;
const STEP = 0.75; // highest ledge you can step onto
const WALK = 3.2, RUN = 7.5;

export default function Explore({ onBack }: { onBack: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  const [dismissed, setDismissed] = useState(false);
  const clan = clanById("arasaka")!;

  useEffect(() => {
    const onResize = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const host = hostRef.current!;
    const env = ENVS.storm;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = skyTexture(env.sky);
    scene.fog = new THREE.Fog(env.fog, 40, 320);
    const hemi = new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemi + 0.35);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(env.sun, env.sunI + 0.4);
    sun.position.set(...env.sunPos);
    scene.add(sun);

    const citadel = buildArasaka(env);
    scene.add(citadel.root);
    const col = citadel.col;

    const hero = new Hero();
    scene.add(hero.root);
    const pos = ARASAKA_SPAWN.clone();
    pos.y = groundAt(pos.x, pos.z);
    let facing = Math.PI; // toward the gate (-z)
    let vy = 0;
    // dev only: lets automated checks teleport the hero and turn him
    if (import.meta.env.DEV) (window as unknown as { __ex: unknown }).__ex = { pos, face: (a: number) => (facing = a), doors: () => col.doors.map((d) => d.open) };

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
    let yaw = 0, pitch = 0.32; // camera sits behind (at +z of) the hero to start
    const camPos = new THREE.Vector3();

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 1 ? 70 : 58;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    /* ----- input ----- */
    const stick = { x: 0, y: 0, id: -1, cx: 0, cy: 0 };
    let look: { id: number; x: number; y: number } | null = null;
    const keys = new Set<string>();
    const el = host;
    const RADIUS = 56;
    const setKnob = () => {
      if (knobRef.current) knobRef.current.style.transform = `translate(${stick.x * RADIUS}px, ${stick.y * RADIUS}px)`;
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      const r = el.getBoundingClientRect();
      if (e.clientX - r.left < r.width * 0.45 && stick.id < 0) {
        // the joystick grabs any touch on the left side; its centre stays fixed like in MLBB
        const b = baseRef.current!.getBoundingClientRect();
        stick.id = e.pointerId;
        stick.cx = b.left + b.width / 2;
        stick.cy = b.top + b.height / 2;
        moveStick(e);
      } else if (!look) look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      el.setPointerCapture?.(e.pointerId);
    };
    const moveStick = (e: PointerEvent) => {
      let dx = (e.clientX - stick.cx) / RADIUS, dy = (e.clientY - stick.cy) / RADIUS;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      stick.x = dx;
      stick.y = dy;
      setKnob();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === stick.id) moveStick(e);
      else if (look && e.pointerId === look.id) {
        yaw -= (e.clientX - look.x) * 0.006;
        pitch = THREE.MathUtils.clamp(pitch + (e.clientY - look.y) * 0.004, -0.15, 1.15);
        look.x = e.clientX;
        look.y = e.clientY;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === stick.id) { stick.id = -1; stick.x = stick.y = 0; setKnob(); }
      if (look && e.pointerId === look.id) look = null;
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    const kd = (e: KeyboardEvent) => keys.add(e.key.toLowerCase());
    const ku = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    /* ----- the world's shape ----- */
    const doorOpen = new Set<Box>();
    const floorAt = (x: number, z: number, y: number) => {
      let best = groundAt(x, z);
      for (const b of col.walk) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.y1 <= y + STEP && b.y1 > best) best = b.y1;
      for (const r of col.ramps) {
        const dx = r.bx - r.ax, dz = r.bz - r.az, L2 = dx * dx + dz * dz;
        const t = ((x - r.ax) * dx + (z - r.az) * dz) / L2;
        if (t < 0 || t > 1) continue;
        const side = Math.abs(((x - r.ax) * dz - (z - r.az) * dx) / Math.sqrt(L2));
        if (side > r.w / 2) continue;
        const h = r.ya + (r.yb - r.ya) * t;
        if (h <= y + STEP && h > best) best = h;
      }
      return best;
    };
    const blocks = (b: Box, y: number) => y + TALL > b.y0 && y < b.y1;
    // push the body (a circle) out of every box it overlaps
    const collide = (p: THREE.Vector3) => {
      const test = (b: Box) => {
        const qx = THREE.MathUtils.clamp(p.x, b.x0, b.x1), qz = THREE.MathUtils.clamp(p.z, b.z0, b.z1);
        const dx = p.x - qx, dz = p.z - qz, d2 = dx * dx + dz * dz;
        if (d2 >= R * R) return;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = qx + (dx / d) * R;
          p.z = qz + (dz / d) * R;
        } else {
          const l = p.x - b.x0, rr = b.x1 - p.x, f = p.z - b.z0, k = b.z1 - p.z, m = Math.min(l, rr, f, k);
          if (m === l) p.x = b.x0 - R; else if (m === rr) p.x = b.x1 + R; else if (m === f) p.z = b.z0 - R; else p.z = b.z1 + R;
        }
      };
      for (let pass = 0; pass < 2; pass++) {
        for (const b of col.solid) if (blocks(b, p.y)) test(b);
        for (const b of col.walk) if (b.y1 > p.y + STEP && blocks(b, p.y)) test(b);
        for (const d of col.doors) if (!doorOpen.has(d.box) && blocks(d.box, p.y)) test(d.box);
      }
    };
    const insideSolid = (v: THREE.Vector3) => {
      const inBox = (b: Box) => v.x > b.x0 && v.x < b.x1 && v.z > b.z0 && v.z < b.z1 && v.y > b.y0 && v.y < b.y1;
      return col.solid.some(inBox) || col.walk.some(inBox) || v.y < groundAt(v.x, v.z) + 0.2;
    };

    /* ----- rain around the hero, lightning ----- */
    const RAIN = 900;
    const rp = new Float32Array(RAIN * 6);
    const drop = (i: number, top = false) => {
      const x = pos.x + (Math.random() - 0.5) * 60, z = pos.z + (Math.random() - 0.5) * 60, y = pos.y + (top ? 30 : Math.random() * 30);
      rp.set([x, y, z, x + 0.15, y + 0.9, z], i * 6);
    };
    for (let i = 0; i < RAIN; i++) drop(i);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(rp, 3));
    const rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xa9b8cc, transparent: true, opacity: 0.4 }));
    rain.frustumCulled = false;
    scene.add(rain);
    let nextFlash = 3, flashT = -1;

    /* ----- loop ----- */
    const clock = new THREE.Clock();
    const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3(), head = new THREE.Vector3(), want = new THREE.Vector3(), probe = new THREE.Vector3();
    let speed = 0, first = true;
    renderer.setAnimationLoop(() => {
      const dt = Math.min(0.05, clock.getDelta());
      if (document.hidden) return;
      const t = clock.elapsedTime;

      // input -> wish direction relative to the camera
      let ix = stick.x, iy = stick.y;
      if (keys.has("a") || keys.has("arrowleft")) ix -= 1;
      if (keys.has("d") || keys.has("arrowright")) ix += 1;
      if (keys.has("w") || keys.has("arrowup")) iy -= 1;
      if (keys.has("s") || keys.has("arrowdown")) iy += 1;
      let amt = Math.min(1, Math.hypot(ix, iy));
      if (keys.size && !keys.has("shift")) amt = Math.min(amt, 0.5);
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      move.set(0, 0, 0).addScaledVector(right, ix).addScaledVector(fwd, -iy);
      if (move.lengthSq() > 1e-4) move.normalize();
      const target = amt < 0.08 ? 0 : amt > 0.75 ? RUN : WALK * Math.max(0.5, amt / 0.75);
      speed += (target - speed) * Math.min(1, dt * 8);
      if (speed > 0.05 && amt > 0.08) {
        const want = Math.atan2(move.x, move.z);
        let d = want - facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        facing += d * Math.min(1, dt * 12);
      }
      const step = Math.min(speed * dt, R * 0.9);
      pos.x += Math.sin(facing) * step;
      pos.z += Math.cos(facing) * step;
      collide(pos);
      pos.x = THREE.MathUtils.clamp(pos.x, -230, 230);
      pos.z = THREE.MathUtils.clamp(pos.z, -170, 240);

      // stand on the highest floor within a step; fall if it drops away
      const floor = floorAt(pos.x, pos.z, pos.y);
      if (floor >= pos.y - 0.05) { pos.y += (floor - pos.y) * Math.min(1, dt * 18); vy = 0; }
      else { vy -= 25 * dt; pos.y = Math.max(floor, pos.y + vy * dt); }

      // doors: open when the hero is close, shut again behind
      for (const d of col.doors) {
        const near = Math.hypot(d.at.x - pos.x, d.at.z - pos.z) < (d.box.x1 - d.box.x0 > 8 || d.box.z1 - d.box.z0 > 8 ? 13 : 3.6) && Math.abs(d.at.y - 1 - pos.y) < 2.5;
        d.target = near ? 1 : 0;
        if (d.open > 0.55) doorOpen.add(d.box); else doorOpen.delete(d.box);
      }

      hero.root.position.copy(pos);
      hero.root.rotation.y = facing;
      hero.animate(speed, dt, t);
      citadel.tick(t, dt);

      // third-person camera behind the hero, pulled in if a wall is in the way
      head.set(pos.x, pos.y + 1.55, pos.z);
      const dist = 5.2;
      want.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      let reach = dist;
      for (let s = 0.4; s <= dist; s += 0.25) {
        probe.copy(head).addScaledVector(want, s);
        if (insideSolid(probe)) { reach = Math.max(0.6, s - 0.4); break; }
      }
      camPos.copy(head).addScaledVector(want, reach);
      if (first) { camera.position.copy(camPos); first = false; } // no swoop in from the middle of the citadel
      else camera.position.lerp(camPos, Math.min(1, dt * 14));
      camera.lookAt(head.x, head.y + 0.1, head.z);

      // rain follows the hero
      for (let i = 0; i < RAIN; i++) {
        const o = i * 6;
        rp[o + 1] -= dt * 28;
        rp[o + 4] -= dt * 28;
        rp[o] -= dt * 4;
        rp[o + 3] -= dt * 4;
        if (rp[o + 1] < pos.y - 3 || Math.abs(rp[o] - pos.x) > 32 || Math.abs(rp[o + 2] - pos.z) > 32) drop(i, true);
      }
      rg.attributes.position.needsUpdate = true;

      nextFlash -= dt;
      if (nextFlash <= 0) { flashT = 0; nextFlash = 5 + Math.random() * 8; }
      let f = 0;
      if (flashT >= 0) {
        flashT += dt;
        f = flashT < 0.08 ? 1 : flashT < 0.16 ? 0.25 : flashT < 0.26 ? 0.8 : Math.max(0, 1 - (flashT - 0.26) * 4);
        if (flashT > 0.6) flashT = -1;
      }
      hemi.intensity = env.hemi + 0.35 + f * 2.5;
      if (flashRef.current) flashRef.current.style.opacity = String(f * 0.4);

      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="ex" ref={hostRef}>
      <div ref={flashRef} className="lightning-flash" />
      <header className="ex-top">
        <button className="wm-round" onClick={onBack} aria-label="Back">‹</button>
        <div className="ex-crest">
          <ClanLogo clan={clan} size={30} />
          <span>Arasaka</span>
        </div>
      </header>
      <div className="ex-stick" ref={baseRef}>
        <div className="ex-knob" ref={knobRef} />
      </div>
      <div className="ex-hint">Drag here to look around</div>
      {portrait && !dismissed && (
        <div className="ex-rotate" onClick={() => setDismissed(true)}>
          <div className="ex-phone" />
          <b>Turn your phone sideways</b>
          <span>Tap to play upright anyway</span>
        </div>
      )}
    </div>
  );
}

