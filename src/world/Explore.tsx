import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { buildArasaka, groundAt, ARASAKA_SPAWN, type Box, type Door } from "../palace/arasaka";
import { skyTexture } from "../palace/buildPalace";
import { ENVS } from "../palace/weather";
import { clanById } from "../clans";
import ClanLogo from "../ClanLogo";
import { Hero } from "./hero";

// Walk around the Arasaka citadel in third person (landscape, MLBB-style controls):
// - left thumb: the joystick steers
// - right thumb: the big button (tap = jump, hold = run), drag anywhere else to look around (even up at the sky)
// - the curved button by it is the action of the moment: BATTLE lights up red when a person is near;
//   when more than one thing can be done (a door AND a person), it splits into small buttons.
// On a computer: WASD or arrows, Space to jump, Shift to run, E for the action, drag to look.

const R = 0.38; // body radius
const TALL = 1.7;
const STEP = 0.75; // highest ledge you can step onto
const WALK = 3.4, RUN = 7.5, JUMP = 7.2, GRAVITY = 22;
const BATTLE_RANGE = 7;
const RIVAL_NAME = "Rival";
// short display name over your head, like "DIAM (you)". The test page has no sign-in, so ?name=Diamond sets it.
const shortName = (full: string) => full.trim().split(/\s+/)[0].slice(0, 6).toUpperCase();
const MY_NAME = shortName(new URLSearchParams(location.search).get("name") || "Player");

const MODES = [
  { id: "brawl", name: "Brawl", time: "1 min", bet: 5 },
  { id: "classic", name: "Classic", time: "3 min", bet: 10 },
  { id: "rank", name: "Rank", time: "7 min", bet: 100 },
] as const;

type Action = "door" | "battle" | "more";
type Ui = { actions: Action[]; doorOpen: boolean; battleOn: boolean };
// what the buttons call inside the 3D loop
type Api = { jumpDown: () => void; jumpUp: () => void; act: (a: Action) => void; challenged: (on: boolean) => void; wave: () => void };

export default function Explore({ onBack }: { onBack: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const youRef = useRef<HTMLDivElement>(null);
  const rivalRef = useRef<HTMLDivElement>(null);
  const api = useRef<Api>({ jumpDown: () => {}, jumpUp: () => {}, act: () => {}, challenged: () => {}, wave: () => {} });
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  const [dismissed, setDismissed] = useState(false);
  const [ui, setUi] = useState<Ui>({ actions: [], doorOpen: false, battleOn: false });
  const [picker, setPicker] = useState(false);
  const [incoming, setIncoming] = useState(false);
  const [more, setMore] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const clan = clanById("arasaka")!;

  useEffect(() => {
    const onResize = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(id);
  }, [toast]);

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
      return col.solid.some(inBox) || col.walk.some(inBox) || col.doors.some((d) => !doorOpen.has(d.box) && inBox(d.box));
    };

    /* ----- you ----- */
    const hero = new Hero();
    scene.add(hero.root);
    const pos = ARASAKA_SPAWN.clone();
    pos.y = groundAt(pos.x, pos.z);
    let facing = Math.PI; // toward the gate (-z)
    let vy = 0, grounded = true, running = false;

    /* ----- a rival waiting in the barracks yard (a stand-in for other players) ----- */
    const rival = new Hero({ tee: 0x3b6fd1, band: 0x1b1a1f, hair: 0x5a2d1a, shoe: 0xf2f2f2 });
    const rivalPos = new THREE.Vector3(6, 0, -2);
    rivalPos.y = floorAt(rivalPos.x, rivalPos.z, 20);
    rival.root.position.copy(rivalPos);
    scene.add(rival.root);
    let rivalFacing = 0;
    // the soft blue glow around whoever the battle button points at
    const aura = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.55, 1.1, 4, 16),
      new THREE.MeshBasicMaterial({ color: 0x2a5bd7, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    aura.position.y = 0.95;
    aura.visible = false;
    rival.root.add(aura);

    // dev only: lets automated checks teleport the hero and turn him
    if (import.meta.env.DEV) (window as unknown as { __ex: unknown }).__ex = { pos, face: (a: number) => (facing = a), doors: () => col.doors.map((d) => d.open) };

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
    let yaw = 0, pitch = 0.3; // camera sits behind (at +z of) the hero to start
    const camPos = new THREE.Vector3();

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 1 ? 72 : 60;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    /* ----- input ----- */
    const stick = { x: 0, y: 0, id: -1 as number, cx: 0, cy: 0 };
    let look: { id: number; x: number; y: number } | null = null;
    const keys = new Set<string>();
    const RADIUS = 52;
    const setKnob = () => {
      if (knobRef.current) knobRef.current.style.transform = `translate(${stick.x * RADIUS}px, ${stick.y * RADIUS}px)`;
    };
    const moveStick = (x: number, y: number) => {
      let dx = (x - stick.cx) / RADIUS, dy = (y - stick.cy) / RADIUS;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      stick.x = dx;
      stick.y = dy;
      setKnob();
    };
    const start = (id: number, x: number, y: number, target: EventTarget | null) => {
      if ((target as HTMLElement | null)?.closest?.("button, .ex-pop, .ex-modes")) return;
      const r = host.getBoundingClientRect();
      if (x - r.left < r.width * 0.42 && stick.id < 0) {
        // any touch on the left side grabs the joystick; its centre stays put like in MLBB
        const b = baseRef.current!.getBoundingClientRect();
        stick.id = id;
        stick.cx = b.left + b.width / 2;
        stick.cy = b.top + b.height / 2;
        moveStick(x, y);
      } else if (!look) look = { id, x, y };
    };
    const drag = (id: number, x: number, y: number) => {
      if (id === stick.id) moveStick(x, y);
      else if (look && id === look.id) {
        yaw -= (x - look.x) * 0.0065;
        pitch = THREE.MathUtils.clamp(pitch + (y - look.y) * 0.0045, -0.75, 1.2);
        look.x = x;
        look.y = y;
      }
    };
    const end = (id: number) => {
      if (id === stick.id) { stick.id = -1; stick.x = stick.y = 0; setKnob(); }
      if (look && id === look.id) look = null;
    };
    // touch events: the most reliable way to follow two thumbs at once on iPhone
    const ts = (e: TouchEvent) => {
      const onUi = (e.target as HTMLElement).closest?.("button, .ex-pop, .ex-modes");
      if (!onUi) e.preventDefault(); // no page scroll, zoom or long-press menu while playing
      for (const t of Array.from(e.changedTouches)) start(t.identifier, t.clientX, t.clientY, t.target);
    };
    const tm = (e: TouchEvent) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) drag(t.identifier, t.clientX, t.clientY);
    };
    const te = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) end(t.identifier); };
    host.addEventListener("touchstart", ts, { passive: false });
    host.addEventListener("touchmove", tm, { passive: false });
    host.addEventListener("touchend", te);
    host.addEventListener("touchcancel", te);
    // mouse on a computer
    const MOUSE = -100;
    const md = (e: MouseEvent) => start(MOUSE, e.clientX, e.clientY, e.target);
    const mm = (e: MouseEvent) => drag(MOUSE, e.clientX, e.clientY);
    const mu = () => end(MOUSE);
    host.addEventListener("mousedown", md);
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);

    // the big right button: tap to jump, hold to run
    let pressAt = -1;
    const jump = () => {
      if (grounded) { vy = JUMP; grounded = false; }
    };
    api.current.jumpDown = () => { pressAt = performance.now(); };
    api.current.jumpUp = () => {
      if (pressAt >= 0 && performance.now() - pressAt < 240) jump();
      pressAt = -1;
      running = false;
    };

    // actions
    let nearDoor: Door | null = null;
    let battleOn = false;
    const doorKeepOpen = new Set<Door>();
    api.current.act = (a) => {
      if (a === "door" && nearDoor) {
        const pair = col.doors.filter((d) => d.at.distanceTo(nearDoor!.at) < 0.01); // both leaves
        const opening = nearDoor.target < 0.5;
        for (const d of pair) { d.target = opening ? 1 : 0; if (opening) doorKeepOpen.add(d); else doorKeepOpen.delete(d); }
      } else if (a === "battle" && battleOn) setPicker(true);
      else if (a === "more") setMore((v) => !v);
    };
    let incomingOn = false, nextChallenge = 8, nearTime = 0;
    api.current.challenged = (on) => {
      incomingOn = on;
      nextChallenge = 45;
    };
    api.current.wave = () => hero.wave();

    const kd = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys.add(k);
      if (k === " ") jump();
      if (k === "e") api.current.act(nearDoor ? "door" : "battle");
    };
    const ku = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

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

    // name tags follow heads on screen
    const v = new THREE.Vector3();
    const tag = (node: HTMLElement | null, p: THREE.Vector3, lift: number) => {
      if (!node) return;
      v.copy(p).setY(p.y + lift).project(camera);
      const hidden = v.z > 1 || camera.position.distanceTo(p) > 40;
      node.style.opacity = hidden ? "0" : "1";
      node.style.transform = `translate(${((v.x * 0.5 + 0.5) * host.clientWidth).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * host.clientHeight).toFixed(1)}px) translate(-50%, -100%)`;
    };

    /* ----- loop ----- */
    const clock = new THREE.Clock();
    const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3(), head = new THREE.Vector3(), dir = new THREE.Vector3(), probe = new THREE.Vector3(), look3 = new THREE.Vector3();
    let speed = 0, first = true, uiKey = "";
    renderer.setAnimationLoop(() => {
      const dt = Math.min(0.05, clock.getDelta());
      if (document.hidden) return;
      const t = clock.elapsedTime;

      // hold the big button to run
      if (pressAt >= 0 && performance.now() - pressAt >= 240) running = true;

      // input -> wish direction relative to the camera
      let ix = stick.x, iy = stick.y;
      if (keys.has("a") || keys.has("arrowleft")) ix -= 1;
      if (keys.has("d") || keys.has("arrowright")) ix += 1;
      if (keys.has("w") || keys.has("arrowup")) iy -= 1;
      if (keys.has("s") || keys.has("arrowdown")) iy += 1;
      const amt = Math.min(1, Math.hypot(ix, iy));
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      move.set(0, 0, 0).addScaledVector(right, ix).addScaledVector(fwd, -iy);
      if (move.lengthSq() > 1e-4) move.normalize();
      const run = running || keys.has("shift");
      const target = amt < 0.1 ? 0 : run ? RUN : WALK * Math.max(0.45, amt);
      speed += (target - speed) * Math.min(1, dt * (grounded ? 8 : 2));
      if (amt > 0.1) {
        let d = Math.atan2(move.x, move.z) - facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        facing += d * Math.min(1, dt * 12);
      }
      const step = Math.min(speed * dt, R * 0.9);
      pos.x += Math.sin(facing) * step;
      pos.z += Math.cos(facing) * step;
      collide(pos);
      // don't walk into the rival either
      const rx = pos.x - rivalPos.x, rz = pos.z - rivalPos.z, rd = Math.hypot(rx, rz);
      if (rd < 2 * R && Math.abs(pos.y - rivalPos.y) < 1.5 && rd > 1e-4) { pos.x = rivalPos.x + (rx / rd) * 2 * R; pos.z = rivalPos.z + (rz / rd) * 2 * R; }
      pos.x = THREE.MathUtils.clamp(pos.x, -230, 230);
      pos.z = THREE.MathUtils.clamp(pos.z, -170, 240);

      // gravity, jumping, and standing on the highest floor within a step
      vy -= GRAVITY * dt;
      pos.y += vy * dt;
      const floor = floorAt(pos.x, pos.z, pos.y + Math.max(0, -vy * dt));
      if (pos.y <= floor + 0.02 || (grounded && pos.y - floor < STEP && vy <= 0)) { pos.y = floor; vy = 0; grounded = true; }
      else grounded = false;

      // doors: find the closest one in reach; open ones close again once you're well away
      nearDoor = null;
      let best = Infinity;
      for (const d of col.doors) {
        const big = d.box.x1 - d.box.x0 > 8 || d.box.z1 - d.box.z0 > 8;
        const dd = Math.hypot(d.at.x - pos.x, d.at.z - pos.z);
        const reach = big ? 14 : 3.8;
        if (dd < reach && Math.abs(d.at.y - 1 - pos.y) < 2.5 && dd < best) { best = dd; nearDoor = d; }
        if (doorKeepOpen.has(d) && dd > (big ? 40 : 12)) { d.target = 0; doorKeepOpen.delete(d); }
        if (d.open > 0.55) doorOpen.add(d.box); else doorOpen.delete(d.box);
      }

      // the rival turns to face you when you come close, and sometimes challenges you
      const toYou = Math.hypot(pos.x - rivalPos.x, pos.z - rivalPos.z);
      if (toYou < 14) {
        let d = Math.atan2(pos.x - rivalPos.x, pos.z - rivalPos.z) - rivalFacing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        rivalFacing += d * Math.min(1, dt * 4);
      }
      rival.root.rotation.y = rivalFacing;
      battleOn = toYou < BATTLE_RANGE && Math.abs(pos.y - rivalPos.y) < 2;
      aura.visible = battleOn;
      aura.material.opacity = 0.22 + Math.sin(t * 4) * 0.06;
      if (toYou < 18 && !incomingOn) {
        nearTime += dt;
        nextChallenge -= dt;
        if (nearTime > 4 && nextChallenge <= 0) { incomingOn = true; setIncoming(true); }
      } else if (toYou >= 18) nearTime = 0;

      // which action buttons to show
      const actions: Action[] = [];
      if (nearDoor) actions.push("door");
      if (battleOn) actions.push("battle");
      if (actions.length > 1 || battleOn) actions.push("more");
      const key = actions.join() + (nearDoor && nearDoor.target > 0.5 ? "o" : "") + (battleOn ? "b" : "");
      if (key !== uiKey) {
        uiKey = key;
        setUi({ actions, doorOpen: !!nearDoor && nearDoor.target > 0.5, battleOn });
      }

      hero.root.position.copy(pos);
      hero.root.rotation.y = facing;
      hero.animate(speed, dt, t, !grounded);
      rival.animate(0, dt, t);
      citadel.tick(t, dt);

      // third-person camera behind the hero, pulled in if a wall is in the way.
      // Pitch below zero drops the camera low behind you so you can look up at the sky.
      head.set(pos.x, pos.y + 1.55, pos.z);
      const dist = 5.4;
      dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      let reach = dist;
      for (let s = 0.4; s <= dist; s += 0.25) {
        probe.copy(head).addScaledVector(dir, s);
        if (insideSolid(probe)) { reach = Math.max(0.6, s - 0.4); break; }
      }
      camPos.copy(head).addScaledVector(dir, reach);
      camPos.y = Math.max(camPos.y, floorAt(camPos.x, camPos.z, pos.y + 1) + 0.3);
      if (first) { camera.position.copy(camPos); first = false; } // no swoop in from the middle of the citadel
      else camera.position.lerp(camPos, Math.min(1, dt * 14));
      // look through the hero's head along the camera direction, so a low camera looks up at the sky
      look3.copy(camPos).addScaledVector(dir, -20);
      camera.lookAt(look3);

      tag(youRef.current, pos, 2.05);
      tag(rivalRef.current, rivalPos, 2.05);

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
      host.removeEventListener("touchstart", ts);
      host.removeEventListener("touchmove", tm);
      host.removeEventListener("touchend", te);
      host.removeEventListener("touchcancel", te);
      host.removeEventListener("mousedown", md);
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
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

  const act = (a: Action) => api.current.act(a);
  const startBattle = (mode: (typeof MODES)[number], from: "you" | "them") => {
    setPicker(false);
    setIncoming(false);
    api.current.challenged(false);
    setToast(
      from === "you"
        ? `${RIVAL_NAME} accepted your ${mode.name} challenge (${mode.time}, ${mode.bet} Respect). In the real game the camera battle starts here.`
        : `You accepted ${RIVAL_NAME}'s ${mode.name} challenge. In the real game the camera battle starts here.`,
    );
  };
  const single = ui.actions.length <= 2 && !(ui.actions.includes("door") && ui.actions.includes("battle"));
  const arc = ui.actions.includes("battle") ? "battle" : ui.actions.includes("door") ? "door" : "battle";
  const label = (a: Action) => (a === "door" ? (ui.doorOpen ? "Close door" : "Open door") : a === "battle" ? "Battle" : "More");

  return (
    <div className="ex" ref={hostRef}>
      <div ref={flashRef} className="lightning-flash" />

      <div ref={youRef} className="ex-tag you">{MY_NAME} (you)</div>
      <div ref={rivalRef} className={`ex-tag ${incoming ? "calling" : ""}`}>
        {incoming && <i className="ex-arrow" />}
        {RIVAL_NAME}
      </div>

      <header className="ex-top">
        <button className="wm-round" onClick={onBack} aria-label="Back">‹</button>
        <div className="ex-crest">
          <ClanLogo clan={clan} size={30} />
          <span>Arasaka</span>
        </div>
      </header>

      {/* left: joystick with direction marks */}
      <div className="ex-stick" ref={baseRef}>
        <svg className="ex-marks" viewBox="0 0 100 100" aria-hidden>
          <path d="M40 17 50 9 60 17 M40 83 50 91 60 83 M17 40 9 50 17 60 M83 40 91 50 83 60" />
        </svg>
        <div className="ex-knob" ref={knobRef} />
      </div>

      {/* right: big jump/run button plus the action arc or small action buttons */}
      <div className="ex-right">
        <button
          className="ex-jump"
          aria-label="Jump (tap) or run (hold)"
          onPointerDown={(e) => { e.preventDefault(); api.current.jumpDown(); }}
          onPointerUp={() => api.current.jumpUp()}
          onPointerCancel={() => api.current.jumpUp()}
          onPointerLeave={() => api.current.jumpUp()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg viewBox="0 0 40 40" aria-hidden>
            <circle cx="16" cy="8" r="4.5" />
            <path d="M17 13 21 23 15 27 M21 23 26 33 M18 16 26 13 M17 17 10 21 M15 27 9 32" />
          </svg>
        </button>
        {single ? (
          <button
            className={`ex-arc ${arc} ${ui.actions.includes(arc) ? "on" : ""}`}
            disabled={!ui.actions.includes(arc)}
            onPointerUp={() => act(arc)}
          >
            <svg viewBox="0 0 120 120" aria-hidden>
              <path id="ex-arc-path" d="M22 116 A70 70 0 0 1 92 14" fill="none" />
              <text style={{ fontSize: label(arc).length > 7 ? 13 : 17 }}>
                <textPath href="#ex-arc-path" startOffset="50%" textAnchor="middle">{label(arc).toUpperCase()}</textPath>
              </text>
            </svg>
          </button>
        ) : (
          <div className="ex-skills">
            {ui.actions.map((a, i) => (
              <button key={a} className={`ex-skill s${i} ${a}`} onPointerUp={() => act(a)} aria-label={label(a)}>
                {a === "door" && <svg viewBox="0 0 24 24"><path d="M6 21V4h9l3 2v15M6 21h12M13 12h1" /></svg>}
                {a === "battle" && <svg viewBox="0 0 24 24"><path d="M4 20 15 9M15 9l2-5 3 3-5 2M20 20 9 9M9 9 7 4 4 7l5 2" /></svg>}
                {a === "more" && <svg viewBox="0 0 24 24"><path d="M6 12h.01M12 12h.01M18 12h.01" /></svg>}
                <span>{label(a)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {more && (
        <div className="ex-modes small">
          <button className="ex-mode" onPointerUp={() => { setMore(false); api.current.wave(); }}>
            <b>Wave</b><span>Say hi</span>
          </button>
          <button className="ex-mode" onPointerUp={() => setMore(false)}><b>Close</b></button>
        </div>
      )}

      {picker && (
        <div className="ex-modes">
          <div className="ex-modes-title">Challenge {RIVAL_NAME}</div>
          {MODES.map((m) => (
            <button key={m.id} className="ex-mode" onPointerUp={() => startBattle(m, "you")}>
              <b>{m.name}</b>
              <span>{m.time} · bet {m.bet} Respect</span>
            </button>
          ))}
          <button className="ex-mode cancel" onPointerUp={() => setPicker(false)}>Cancel</button>
        </div>
      )}

      {incoming && (
        <div className="ex-pop">
          <div className="ex-pop-name">{RIVAL_NAME}</div>
          <div className="ex-pop-card">
            <div className="ex-pop-label">challenges you · Brawl</div>
            <div className="ex-pop-row">
              <button className="ok" aria-label="Accept" onPointerUp={() => startBattle(MODES[0], "them")}>
                <svg viewBox="0 0 24 24"><path d="M4 13l5 5L20 6" /></svg>
              </button>
              <button className="no" aria-label="Decline" onPointerUp={() => { setIncoming(false); api.current.challenged(false); }}>
                <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="ex-toast">{toast}</div>}

      {portrait && !dismissed && (
        <div className="ex-rotate" onPointerUp={() => setDismissed(true)}>
          <div className="ex-phone" />
          <b>Turn your phone sideways</b>
          <span>Tap to play upright anyway</span>
        </div>
      )}
    </div>
  );
}
