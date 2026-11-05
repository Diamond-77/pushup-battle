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
// - right thumb: the big button (tap = jump, hold = run); drag anywhere else to look around, even up at the sky
// - the curved button round it is the action of the moment: BATTLE turns red when someone is near,
//   OPEN DOOR at a door; with more than one, it splits into small skill buttons
// - with 2+ people near, their portraits appear (target lock): tap one to pick who to battle
// On a computer: WASD or arrows, Space to jump, Shift to run, E for the action, drag to look.

const R = 0.38; // body radius
const TALL = 1.7;
const STEP = 0.75; // highest ledge you can step onto
const WALK = 4.2, RUN = 8.2, JUMP = 7.2, GRAVITY = 22;
const BATTLE_RANGE = 8;

const MODES = [
  { id: "brawl", name: "Brawl", time: "1 min", bet: 5 },
  { id: "classic", name: "Classic", time: "3 min", bet: 10 },
  { id: "rank", name: "Rank", time: "7 min", bet: 100 },
] as const;
type Mode = (typeof MODES)[number];

// test players standing in the barracks yard, until real players walk around
const PEOPLE = [
  { name: "Rival", at: [6, -2], colors: { tee: 0x3b6fd1, band: 0x1b1a1f, hair: 0x5a2d1a, shoe: 0xf2f2f2 } },
  { name: "Sensei", at: [-7, -6], colors: { tee: 0x2a2a30, band: 0xe8b84a, hair: 0xd8d8d8, pants: 0x5a4632, shoe: 0x1b1a1f } },
  { name: "Ultra", at: [10, -9], colors: { tee: 0xc8372d, band: 0xf7f7f2, hair: 0x101014, shoe: 0xe8b84a } },
] as const;

// short display name over your head, like "DIAM (you)". The test page has no sign-in, so ?name=Diamond sets it.
const shortName = (full: string) => full.trim().split(/\s+/)[0].slice(0, 6).toUpperCase();
const MY_NAME = shortName(new URLSearchParams(location.search).get("name") || "Player");

/* ----- settings, kept on this phone ----- */
type Settings = { speed: number; look: number; stick: "smooth" | "snappy"; follow: boolean; quality: "low" | "medium" | "high"; invert: boolean };
const DEFAULTS: Settings = { speed: 1, look: 1, stick: "smooth", follow: false, quality: "medium", invert: false };
const SETTINGS_KEY = "pb_explore_settings_v1";
function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

type Action = "door" | "battle" | "more";
type Ui = { actions: Action[]; doorOpen: boolean; near: string[]; target: string | null };
// what the buttons call inside the 3D loop
type Api = { jumpDown: () => void; jumpUp: () => void; act: (a: Action) => void; lock: (name: string) => void; challenged: (name: string | null) => void; wave: () => void };

export default function Explore({ onBack }: { onBack: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const dirRef = useRef<HTMLDivElement>(null);
  const jumpRef = useRef<HTMLButtonElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const youRef = useRef<HTMLDivElement>(null);
  const tagRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const api = useRef<Api>({ jumpDown: () => {}, jumpUp: () => {}, act: () => {}, lock: () => {}, challenged: () => {}, wave: () => {} });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const settingsRef = useRef(settings);
  const [showSettings, setShowSettings] = useState(false);
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  const [dismissed, setDismissed] = useState(false);
  const [ui, setUi] = useState<Ui>({ actions: [], doorOpen: false, near: [], target: null });
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const clan = clanById("arasaka")!;

  useEffect(() => {
    settingsRef.current = settings;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* private mode: settings just won't be remembered */
    }
  }, [settings]);

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
    const outlines: THREE.Object3D[] = [];
    citadel.root.traverse((o) => { if ((o as THREE.LineSegments).isLineSegments) outlines.push(o); });

    /* ----- the world's shape, bucketed in a grid so each check only looks at nearby boxes ----- */
    const CELL = 10;
    const grid = new Map<string, { b: Box; kind: "walk" | "solid" | "door"; door?: Door }[]>();
    const add = (b: Box, kind: "walk" | "solid" | "door", door?: Door) => {
      for (let cx = Math.floor(b.x0 / CELL); cx <= Math.floor(b.x1 / CELL); cx++)
        for (let cz = Math.floor(b.z0 / CELL); cz <= Math.floor(b.z1 / CELL); cz++) {
          const k = cx + "," + cz;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k)!.push({ b, kind, door });
        }
    };
    col.walk.forEach((b) => add(b, "walk"));
    col.solid.forEach((b) => add(b, "solid"));
    col.doors.forEach((d) => add(d.box, "door", d));
    const EMPTY: never[] = [];
    const cellAt = (x: number, z: number) => grid.get(Math.floor(x / CELL) + "," + Math.floor(z / CELL)) ?? EMPTY;
    const doorOpen = new Set<Box>();

    const floorAt = (x: number, z: number, y: number) => {
      let best = groundAt(x, z);
      for (const { b, kind } of cellAt(x, z)) if (kind === "walk" && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.y1 <= y + STEP && b.y1 > best) best = b.y1;
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
      for (let pass = 0; pass < 2; pass++)
        for (const { b, kind } of cellAt(p.x, p.z)) {
          if (!blocks(b, p.y)) continue;
          if (kind === "solid" || (kind === "walk" && b.y1 > p.y + STEP) || (kind === "door" && !doorOpen.has(b))) test(b);
        }
    };
    const insideSolid = (v: THREE.Vector3) => {
      for (const { b, kind } of cellAt(v.x, v.z))
        if (v.x > b.x0 && v.x < b.x1 && v.z > b.z0 && v.z < b.z1 && v.y > b.y0 && v.y < b.y1 && (kind !== "door" || !doorOpen.has(b))) return true;
      return false;
    };

    /* ----- you ----- */
    const hero = new Hero();
    scene.add(hero.root);
    const pos = ARASAKA_SPAWN.clone();
    pos.y = groundAt(pos.x, pos.z);
    let facing = Math.PI; // toward the gate (-z)
    let vy = 0, grounded = true, running = false;

    /* ----- other people ----- */
    const people = PEOPLE.map((p) => {
      const h = new Hero(p.colors);
      const at = new THREE.Vector3(p.at[0], 0, p.at[1]);
      at.y = floorAt(at.x, at.z, 20);
      h.root.position.copy(at);
      scene.add(h.root);
      return { name: p.name, hero: h, pos: at, facing: 0 };
    });

    // portraits for target lock: a close-up of each person's face, rendered once
    {
      const rt = new THREE.WebGLRenderTarget(112, 112, { colorSpace: THREE.SRGBColorSpace });
      const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 30);
      const px = new Uint8Array(112 * 112 * 4);
      const out: Record<string, string> = {};
      for (const p of people) {
        p.hero.animate(0, 0.016, 0);
        cam.position.set(p.pos.x + 0.35, p.pos.y + 1.72, p.pos.z + 1.05);
        cam.lookAt(p.pos.x, p.pos.y + 1.6, p.pos.z);
        renderer.setRenderTarget(rt);
        renderer.render(scene, cam);
        renderer.readRenderTargetPixels(rt, 0, 0, 112, 112, px);
        const c = document.createElement("canvas");
        c.width = c.height = 112;
        const g = c.getContext("2d")!;
        const img = g.createImageData(112, 112);
        for (let y = 0; y < 112; y++) img.data.set(px.subarray((111 - y) * 448, (112 - y) * 448), y * 448); // flip upright
        g.putImageData(img, 0, 0);
        out[p.name] = c.toDataURL();
      }
      renderer.setRenderTarget(null);
      rt.dispose();
      setAvatars(out);
    }

    // dev only: lets automated checks teleport the hero and turn him
    if (import.meta.env.DEV) (window as unknown as { __ex: unknown }).__ex = { pos, face: (a: number) => (facing = a), doors: () => col.doors.map((d) => d.open) };

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
    let yaw = 0, pitch = 0.3; // camera sits behind (at +z of) the hero to start
    const camPos = new THREE.Vector3();

    let quality = "";
    const applyQuality = () => {
      const q = settingsRef.current.quality;
      if (q === quality) return;
      quality = q;
      renderer.setPixelRatio(q === "low" ? 1 : q === "medium" ? Math.min(window.devicePixelRatio, 1.4) : Math.min(window.devicePixelRatio, 2));
      outlines.forEach((o) => (o.visible = q !== "low"));
      resize();
    };
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 1 ? 72 : 60;
      camera.updateProjectionMatrix();
    };
    applyQuality();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    /* ----- input ----- */
    const stick = { x: 0, y: 0, id: -1 as number, cx: 0, cy: 0 };
    let look: { id: number; x: number; y: number } | null = null;
    const keys = new Set<string>();
    const RADIUS = 50;
    const drawStick = () => {
      const l = Math.hypot(stick.x, stick.y);
      if (knobRef.current) knobRef.current.style.transform = `translate(${stick.x * RADIUS}px, ${stick.y * RADIUS}px)`;
      if (dirRef.current) {
        dirRef.current.style.opacity = String(Math.min(1, l * 1.6));
        dirRef.current.style.transform = `rotate(${Math.atan2(stick.x, -stick.y)}rad)`;
      }
    };
    const moveStick = (x: number, y: number) => {
      let dx = (x - stick.cx) / RADIUS, dy = (y - stick.cy) / RADIUS;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      stick.x = dx;
      stick.y = dy;
      drawStick();
    };
    const homeStick = () => {
      const b = baseRef.current;
      if (b) { b.style.left = ""; b.style.top = ""; b.style.bottom = ""; b.classList.remove("live"); }
    };
    const start = (id: number, x: number, y: number, target: EventTarget | null) => {
      if ((target as HTMLElement | null)?.closest?.("button, .ex-pop, .ex-modes, .ex-lock, .ex-settings")) return;
      const r = host.getBoundingClientRect();
      if (x - r.left < r.width * 0.42 && stick.id < 0) {
        // any touch on the left side takes the joystick; with "follows thumb" it jumps to where you touched
        const base = baseRef.current!;
        if (settingsRef.current.follow) {
          base.style.left = `${x - r.left - base.offsetWidth / 2}px`;
          base.style.top = `${y - r.top - base.offsetHeight / 2}px`;
          base.style.bottom = "auto";
        }
        base.classList.add("live");
        const b = base.getBoundingClientRect();
        stick.id = id;
        stick.cx = b.left + b.width / 2;
        stick.cy = b.top + b.height / 2;
        moveStick(x, y);
      } else if (!look) look = { id, x, y };
    };
    const drag = (id: number, x: number, y: number) => {
      if (id === stick.id) moveStick(x, y);
      else if (look && id === look.id) {
        const s = settingsRef.current;
        yaw -= (x - look.x) * 0.0065 * s.look;
        pitch = THREE.MathUtils.clamp(pitch + (y - look.y) * 0.0045 * s.look * (s.invert ? -1 : 1), -0.75, 1.2);
        look.x = x;
        look.y = y;
      }
    };
    const end = (id: number) => {
      if (id === stick.id) { stick.id = -1; stick.x = stick.y = 0; drawStick(); homeStick(); }
      if (look && id === look.id) look = null;
    };
    // touch events: the most reliable way to follow two thumbs at once on iPhone
    const UI = "button, .ex-pop, .ex-modes, .ex-lock, .ex-settings";
    const ts = (e: TouchEvent) => {
      if (!(e.target as HTMLElement).closest?.(UI)) e.preventDefault(); // no page scroll, zoom or long-press menu
      for (const t of Array.from(e.changedTouches)) start(t.identifier, t.clientX, t.clientY, t.target);
    };
    const tm = (e: TouchEvent) => {
      if (!(e.target as HTMLElement).closest?.(".ex-settings")) e.preventDefault();
      for (const t of Array.from(e.changedTouches)) drag(t.identifier, t.clientX, t.clientY);
    };
    const te = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) end(t.identifier); };
    host.addEventListener("touchstart", ts, { passive: false });
    host.addEventListener("touchmove", tm, { passive: false });
    host.addEventListener("touchend", te);
    host.addEventListener("touchcancel", te);
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
      if (pressAt >= 0 && performance.now() - pressAt < 220) jump();
      pressAt = -1;
      running = false;
      jumpRef.current?.classList.remove("running");
    };

    // actions
    let nearDoor: Door | null = null;
    let near: typeof people = [];
    let locked: string | null = null;
    const doorKeepOpen = new Set<Door>();
    api.current.act = (a) => {
      if (a === "door" && nearDoor) {
        const pair = col.doors.filter((d) => d.at.distanceTo(nearDoor!.at) < 0.01); // both leaves
        const opening = nearDoor.target < 0.5;
        for (const d of pair) { d.target = opening ? 1 : 0; if (opening) doorKeepOpen.add(d); else doorKeepOpen.delete(d); }
      } else if (a === "battle" && near.length) setPicker(near.find((p) => p.name === locked)?.name ?? near[0].name);
      else if (a === "more") setMore((v) => !v);
    };
    api.current.lock = (name) => { locked = name; uiKey = ""; };
    let challenger: string | null = null, nextChallenge = 8, nearTime = 0;
    api.current.challenged = (name) => {
      challenger = name;
      if (!name) nextChallenge = 45;
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
      // a slow frame moves you further instead of slowing the world down (up to a 10 fps hiccup)
      const dt = Math.min(0.1, clock.getDelta());
      if (document.hidden) return;
      const t = clock.elapsedTime;
      const S = settingsRef.current;
      applyQuality();
      rain.visible = S.quality !== "low";

      // hold the big button to run
      if (pressAt >= 0 && performance.now() - pressAt >= 220 && !running) { running = true; jumpRef.current?.classList.add("running"); }

      // input -> wish direction relative to the camera, through the chosen stick feel
      let ix = stick.x, iy = stick.y;
      if (keys.has("a") || keys.has("arrowleft")) ix -= 1;
      if (keys.has("d") || keys.has("arrowright")) ix += 1;
      if (keys.has("w") || keys.has("arrowup")) iy -= 1;
      if (keys.has("s") || keys.has("arrowdown")) iy += 1;
      const raw = Math.min(1, Math.hypot(ix, iy));
      const dead = S.stick === "snappy" ? 0.06 : 0.12;
      const amt = raw < dead ? 0 : Math.pow((raw - dead) / (1 - dead), S.stick === "snappy" ? 0.6 : 1.2);
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      move.set(0, 0, 0).addScaledVector(right, ix).addScaledVector(fwd, -iy);
      if (move.lengthSq() > 1e-4) move.normalize();
      const run = running || keys.has("shift");
      const wantSpeed = amt === 0 ? 0 : (run ? RUN : WALK * (0.35 + 0.65 * amt)) * S.speed;
      speed += (wantSpeed - speed) * Math.min(1, dt * (grounded ? 10 : 2.5));
      if (amt > 0) {
        let d = Math.atan2(move.x, move.z) - facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        facing += d * Math.min(1, dt * (S.stick === "snappy" ? 20 : 13));
      }
      // move in small sub-steps so fast running never skips through a wall
      const total = speed * dt, n = Math.max(1, Math.ceil(total / (R * 0.7)));
      for (let i = 0; i < n; i++) {
        pos.x += (Math.sin(facing) * total) / n;
        pos.z += (Math.cos(facing) * total) / n;
        collide(pos);
        for (const p of people) {
          const rx = pos.x - p.pos.x, rz = pos.z - p.pos.z, rd = Math.hypot(rx, rz);
          if (rd < 2 * R && Math.abs(pos.y - p.pos.y) < 1.5 && rd > 1e-4) { pos.x = p.pos.x + (rx / rd) * 2 * R; pos.z = p.pos.z + (rz / rd) * 2 * R; }
        }
      }
      pos.x = THREE.MathUtils.clamp(pos.x, -230, 230);
      pos.z = THREE.MathUtils.clamp(pos.z, -170, 240);

      // gravity, jumping, and standing on the highest floor within a step
      vy -= GRAVITY * dt;
      pos.y += vy * dt;
      const floor = floorAt(pos.x, pos.z, pos.y + Math.max(0, -vy * dt));
      if (pos.y <= floor + 0.02 || (grounded && pos.y - floor < STEP && vy <= 0)) { pos.y = floor; vy = 0; grounded = true; }
      else grounded = false;

      // doors: the closest one in reach; open ones close again once you're well away
      nearDoor = null;
      let best = Infinity;
      for (const d of col.doors) {
        const big = d.box.x1 - d.box.x0 > 8 || d.box.z1 - d.box.z0 > 8;
        const dd = Math.hypot(d.at.x - pos.x, d.at.z - pos.z);
        if (dd < (big ? 14 : 3.8) && Math.abs(d.at.y - 1 - pos.y) < 2.5 && dd < best) { best = dd; nearDoor = d; }
        if (doorKeepOpen.has(d) && dd > (big ? 40 : 12)) { d.target = 0; doorKeepOpen.delete(d); }
        if (d.open > 0.55) doorOpen.add(d.box); else doorOpen.delete(d.box);
      }

      // people turn to face you when you come close; the nearest ones can be battled
      near = [];
      let nearest18: (typeof people)[number] | null = null;
      for (const p of people) {
        const d = Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z);
        if (d < 14) {
          let a = Math.atan2(pos.x - p.pos.x, pos.z - p.pos.z) - p.facing;
          a = Math.atan2(Math.sin(a), Math.cos(a));
          p.facing += a * Math.min(1, dt * 4);
        }
        p.hero.root.rotation.y = p.facing;
        p.hero.animate(0, dt, t + p.pos.x);
        if (d < BATTLE_RANGE && Math.abs(pos.y - p.pos.y) < 2) near.push(p);
        if (d < 18 && (!nearest18 || d < Math.hypot(pos.x - nearest18.pos.x, pos.z - nearest18.pos.z))) nearest18 = p;
      }
      near.sort((a, b) => Math.hypot(pos.x - a.pos.x, pos.z - a.pos.z) - Math.hypot(pos.x - b.pos.x, pos.z - b.pos.z));
      if (locked && !near.some((p) => p.name === locked)) locked = null;
      const target = near.length ? (locked ?? near[0].name) : null;

      // now and then someone near challenges you
      if (nearest18 && !challenger) {
        nearTime += dt;
        nextChallenge -= dt;
        if (nearTime > 4 && nextChallenge <= 0) { challenger = nearest18.name; setIncoming(challenger); }
      } else if (!nearest18) nearTime = 0;

      // which buttons to show
      const actions: Action[] = [];
      if (nearDoor) actions.push("door");
      if (near.length) actions.push("battle");
      if (near.length) actions.push("more");
      const key = actions.join() + (nearDoor && nearDoor.target > 0.5 ? "o" : "") + near.map((p) => p.name).join() + "|" + target;
      if (key !== uiKey) {
        uiKey = key;
        setUi({ actions, doorOpen: !!nearDoor && nearDoor.target > 0.5, near: near.map((p) => p.name), target });
      }

      hero.root.position.copy(pos);
      hero.root.rotation.y = facing;
      hero.animate(speed, dt, t, !grounded);
      citadel.tick(t, dt);

      // third-person camera behind the hero, pulled in if a wall is in the way.
      // Below zero pitch the camera drops low behind you so you can look up at the sky.
      head.set(pos.x, pos.y + 1.55, pos.z);
      const dist = 5.4;
      dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      let reach = dist;
      for (let s = 0.4; s <= dist; s += 0.3) {
        probe.copy(head).addScaledVector(dir, s);
        if (insideSolid(probe)) { reach = Math.max(0.6, s - 0.4); break; }
      }
      camPos.copy(head).addScaledVector(dir, reach);
      camPos.y = Math.max(camPos.y, floorAt(camPos.x, camPos.z, pos.y + 1) + 0.3);
      if (first) { camera.position.copy(camPos); first = false; } // no swoop in from the middle of the citadel
      else camera.position.lerp(camPos, Math.min(1, dt * 16));
      look3.copy(camPos).addScaledVector(dir, -20);
      camera.lookAt(look3);

      tag(youRef.current, pos, 2.05);
      for (const p of people) tag(tagRefs.current[p.name], p.pos, 2.05);

      // rain follows the hero
      if (rain.visible) {
        for (let i = 0; i < RAIN; i++) {
          const o = i * 6;
          rp[o + 1] -= dt * 28;
          rp[o + 4] -= dt * 28;
          rp[o] -= dt * 4;
          rp[o + 3] -= dt * 4;
          if (rp[o + 1] < pos.y - 3 || Math.abs(rp[o] - pos.x) > 32 || Math.abs(rp[o + 2] - pos.z) > 32) drop(i, true);
        }
        rg.attributes.position.needsUpdate = true;
      }

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
  const startBattle = (who: string, mode: Mode, from: "you" | "them") => {
    setPicker(null);
    setIncoming(null);
    api.current.challenged(null);
    setToast(
      from === "you"
        ? `${who} accepted your ${mode.name} challenge (${mode.time}, ${mode.bet} Respect). In the real game the camera battle starts here.`
        : `You accepted ${who}'s ${mode.name} challenge. In the real game the camera battle starts here.`,
    );
  };
  const set = <K extends keyof Settings>(k: K, val: Settings[K]) => setSettings((s) => ({ ...s, [k]: val }));
  const multi = ui.actions.includes("door") && ui.actions.includes("battle");
  const arc: Action = ui.actions.includes("battle") ? "battle" : ui.actions.includes("door") ? "door" : "battle";
  const label = (a: Action) => (a === "door" ? (ui.doorOpen ? "Close door" : "Open door") : a === "battle" ? "Battle" : "More");
  const pointed = incoming ?? ui.target; // who the red triangle points at

  return (
    <div className="ex" ref={hostRef}>
      <div ref={flashRef} className="lightning-flash" />

      <div ref={youRef} className="ex-tag you">{MY_NAME} (you)</div>
      {PEOPLE.map((p) => (
        <div key={p.name} ref={(n) => { tagRefs.current[p.name] = n; }} className={`ex-tag ${pointed === p.name ? "pointed" : ""}`}>
          <i className="ex-arrow" />
          {p.name}
        </div>
      ))}

      <header className="ex-top">
        <button className="wm-round" onClick={onBack} aria-label="Back">‹</button>
        <div className="ex-crest">
          <ClanLogo clan={clan} size={30} />
          <span>Arasaka</span>
        </div>
        <button className="wm-round ex-gear" onClick={() => setShowSettings(true)} aria-label="Settings">
          <svg viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
        </button>
      </header>

      {/* left: the joystick */}
      <div className="ex-stick" ref={baseRef}>
        <div className="ex-ring" />
        <div className="ex-dir" ref={dirRef} />
        <div className="ex-knob" ref={knobRef} />
      </div>

      {/* target lock: portraits of everyone in reach, tap one to pick who to battle */}
      {ui.near.length > 1 && (
        <div className="ex-lock">
          {ui.near.map((n) => (
            <button key={n} className={`ex-face ${ui.target === n ? "on" : ""}`} onPointerUp={() => api.current.lock(n)} aria-label={`Target ${n}`}>
              {avatars[n] ? <img src={avatars[n]} alt="" /> : <b>{n[0]}</b>}
              <span>{n}</span>
            </button>
          ))}
        </div>
      )}

      {/* right: big jump/run button plus the action arc, or small skill buttons */}
      <div className="ex-right">
        <button
          ref={jumpRef}
          className="ex-jump"
          aria-label="Jump (tap) or run (hold)"
          onPointerDown={(e) => { e.preventDefault(); api.current.jumpDown(); }}
          onPointerUp={() => api.current.jumpUp()}
          onPointerCancel={() => api.current.jumpUp()}
          onPointerLeave={() => api.current.jumpUp()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg viewBox="0 0 40 40" aria-hidden>
            <circle cx="21" cy="7.5" r="3.6" />
            <path d="M20 12.5 17 21l5 4-2 9M17 21l-6 4M19 14l6 4 5-3M14 16l5-3" />
          </svg>
          <em>Hold to run</em>
        </button>
        {!multi ? (
          <button className={`ex-arc ${arc} ${ui.actions.includes(arc) ? "on" : ""}`} disabled={!ui.actions.includes(arc)} onPointerUp={() => act(arc)}>
            <svg viewBox="0 0 150 150" aria-hidden>
              <defs>
                <linearGradient id="ex-arc-on" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0" stopColor="#8f241b" />
                  <stop offset="1" stopColor="#e0483b" />
                </linearGradient>
                <linearGradient id="ex-arc-door" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0" stopColor="#5a3f1f" />
                  <stop offset="1" stopColor="#a8834a" />
                </linearGradient>
              </defs>
              <path className="band" d="M46 138 A92 92 0 0 1 138 46" />
              <path id="ex-arc-path" d="M46 138 A92 92 0 0 1 138 46" fill="none" stroke="none" />
              <text style={{ fontSize: label(arc).length > 7 ? 14 : 17 }}>
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
            <b>Wave</b>
            <span>Say hi</span>
          </button>
          <button className="ex-mode cancel" onPointerUp={() => setMore(false)}>Close</button>
        </div>
      )}

      {picker && (
        <div className="ex-modes">
          <div className="ex-modes-head">
            {avatars[picker] && <img src={avatars[picker]} alt="" />}
            <div className="ex-modes-title">Challenge {picker}</div>
          </div>
          {MODES.map((m) => (
            <button key={m.id} className="ex-mode" onPointerUp={() => startBattle(picker, m, "you")}>
              <b>{m.name}</b>
              <span>{m.time} · bet {m.bet} Respect</span>
            </button>
          ))}
          <button className="ex-mode cancel" onPointerUp={() => setPicker(null)}>Cancel</button>
        </div>
      )}

      {incoming && (
        <div className="ex-pop">
          <div className="ex-pop-who">
            {avatars[incoming] && <img src={avatars[incoming]} alt="" />}
            <div className="ex-pop-name">{incoming}</div>
          </div>
          <div className="ex-pop-card">
            <div className="ex-pop-label">challenges you · Brawl</div>
            <div className="ex-pop-row">
              <button className="ok" aria-label="Accept" onPointerUp={() => startBattle(incoming, MODES[0], "them")}>
                <svg viewBox="0 0 24 24"><path d="M4 13l5 5L20 6" /></svg>
              </button>
              <button className="no" aria-label="Decline" onPointerUp={() => { setIncoming(null); api.current.challenged(null); }}>
                <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="ex-toast">{toast}</div>}

      {showSettings && (
        <div className="ex-settings" onPointerUp={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
          <div className="ex-settings-card">
            <div className="ex-settings-title">Controls</div>
            <label className="ex-row">
              <span>Move speed <b>{Math.round(settings.speed * 100)}%</b></span>
              <input id="ex-speed" type="range" min="0.6" max="1.6" step="0.05" value={settings.speed} onChange={(e) => set("speed", Number(e.target.value))} />
            </label>
            <label className="ex-row">
              <span>Look sensitivity <b>{Math.round(settings.look * 100)}%</b></span>
              <input id="ex-look" type="range" min="0.3" max="2.2" step="0.05" value={settings.look} onChange={(e) => set("look", Number(e.target.value))} />
            </label>
            <div className="ex-row">
              <span>Joystick feel</span>
              <div className="ex-seg">
                <button className={settings.stick === "smooth" ? "on" : ""} onClick={() => set("stick", "smooth")}>Smooth</button>
                <button className={settings.stick === "snappy" ? "on" : ""} onClick={() => set("stick", "snappy")}>Snappy</button>
              </div>
            </div>
            <div className="ex-row">
              <span>Joystick position</span>
              <div className="ex-seg">
                <button className={!settings.follow ? "on" : ""} onClick={() => set("follow", false)}>Fixed</button>
                <button className={settings.follow ? "on" : ""} onClick={() => set("follow", true)}>Follows thumb</button>
              </div>
            </div>
            <div className="ex-row">
              <span>Look up/down</span>
              <div className="ex-seg">
                <button className={!settings.invert ? "on" : ""} onClick={() => set("invert", false)}>Normal</button>
                <button className={settings.invert ? "on" : ""} onClick={() => set("invert", true)}>Inverted</button>
              </div>
            </div>
            <div className="ex-row">
              <span>Graphics</span>
              <div className="ex-seg">
                {(["low", "medium", "high"] as const).map((q) => (
                  <button key={q} className={settings.quality === q ? "on" : ""} onClick={() => set("quality", q)}>{q[0].toUpperCase() + q.slice(1)}</button>
                ))}
              </div>
            </div>
            <p className="ex-note">Low graphics drops the ink outlines and rain, for smoother movement on older phones.</p>
            <div className="ex-settings-foot">
              <button className="ex-mode cancel" onClick={() => setSettings(DEFAULTS)}>Reset</button>
              <button className="game-btn jade" onClick={() => setShowSettings(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

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
