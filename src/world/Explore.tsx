import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { buildArasaka, groundAt, ARASAKA_SPAWN, type Box, type Door, type Lift } from "../palace/arasaka";
import { skyTexture } from "../palace/buildPalace";
import { ENVS } from "../palace/weather";
import { supabase } from "../supabase";
import { clanById } from "../clans";
import ClanLogo from "../ClanLogo";
import { Hero } from "./hero";
import { Billboard } from "./billboard";
import { buildNeon } from "./neon";
import { buildAura } from "./aura";
import { skyNow, type SkyNow } from "./sky";
import { buildWeatherBoard } from "./weatherBoard";
import { buildSpeakers } from "./speakers";
import { buildStreet } from "./street";
import { buildTrain } from "./train";
import { buildBenches, type Seat } from "./benches";
import { playChime, unlockChime } from "./chime";
import { Online, lookFor } from "./players";
import { pinMarkers, loadPins, addPin, deletePin, updatePin, pinsText, type Pin } from "./pins";
import { CONTACT_EMAIL } from "../config";
import { Radio, videoId, videoTitle, thumb, playlistId, playlistSongs, search, canSearch, type RadioState, type Found } from "./music";

// Walk around the Arasaka citadel in third person (landscape, MLBB-style controls):
// - left thumb: the joystick steers
// - right thumb: the big button (tap = jump, hold = run); drag anywhere else to look around, even up at the sky
// - the curved button round it is the action of the moment: BATTLE turns red when someone is near,
//   OPEN DOOR at a door; with more than one, it splits into small skill buttons
// - with 2+ people near, their portraits appear (target lock): tap one to pick who to battle
// - the lawn billboard outside the gate plays friends' voted YouTube songs, in sync for everyone
// On a computer: WASD or arrows, Space to jump, Shift to run, E for the action, drag to look.

const R = 0.38; // body radius
const TALL = 1.7;
const STEP = 0.75; // highest ledge you can step onto
const WALK = 4.2, RUN = 8.2, JUMP = 7.2, GRAVITY = 22;
const BATTLE_RANGE = 8;
const RADIO_RANGE = 45; // close enough to open the song list
// the giant screen stands in the lower court against the terrace wall, turned toward the gate
const BOARD_AT = new THREE.Vector3(-30, 0.3, 30);
const BOARD_RY = 0.35;
const BOARD_SIZE = 2.2; // a 35 x 20 m screen
// the citadel's walls: the music fills everything inside and fades out past them
const CITADEL = { x: 80, front: 88, back: -104 };
// near: how loud the nearest speaker is (1 right next to one). Anywhere in the citadel you still hear
// it faintly, fading out past the walls.
const loudness = (p: THREE.Vector3, near: number) => {
  const out = Math.max(Math.abs(p.x) - CITADEL.x, p.z - CITADEL.front, CITADEL.back - p.z, 0);
  return Math.max(near, 0.18 * THREE.MathUtils.clamp(1 - out / 60, 0, 1));
};

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

// short display name over your head, like "DIAMON (you)". Signed in it's your username; without, ?name=Diamond sets it.
const shortName = (full: string) => full.trim().split(/\s+/)[0].slice(0, 6).toUpperCase();
const GUEST_NAME = new URLSearchParams(location.search).get("name") || "Player";
export type Me = { id: string; name: string; email?: string | null };

/* ----- settings, kept on this phone ----- */
type Settings = { speed: number; look: number; stick: "smooth" | "snappy"; follow: boolean; quality: "low" | "medium" | "high"; invert: boolean; view: "first" | "third" };
const DEFAULTS: Settings = { speed: 1, look: 1, stick: "smooth", follow: false, quality: "medium", invert: false, view: "first" };
const SETTINGS_KEY = "pb_explore_settings_v1";
function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

type Action = "door" | "battle" | "music" | "sit" | "chat" | "more";
type Ui = { actions: Action[]; doorOpen: boolean; near: string[]; target: string | null; hear: boolean; row: number };
type ChatMsg = { key: string; name: string; text: string; mine: boolean; at: number };
// what the buttons call inside the 3D loop
type Api = { jumpDown: () => void; jumpUp: () => void; act: (a: Action) => void; lock: (name: string) => void; challenged: (name: string | null) => void; wave: () => void; listen: (on: boolean) => void; progress: () => { t: number; d: number }; challenge: (key: string, mode: string) => boolean; answer: (key: string, mode: string, ok: boolean) => boolean; chat: (text: string) => void; here: () => { x: number; y: number; z: number; yaw: number; pitch: number }; goTo: (p: Pin) => void; showPins: (p: Pin[]) => void };

export default function Explore({ onBack, me: account }: { onBack: () => void; me?: Me | null }) {
  const myName = shortName(account?.name || GUEST_NAME);
  const hostRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const dirRef = useRef<HTMLDivElement>(null);
  const jumpRef = useRef<HTMLButtonElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const youRef = useRef<HTMLDivElement>(null);
  const tagRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const api = useRef<Api>({ jumpDown: () => {}, jumpUp: () => {}, act: () => {}, lock: () => {}, challenged: () => {}, wave: () => {}, listen: () => {}, progress: () => ({ t: 0, d: 0 }), challenge: () => false, answer: () => false, chat: () => {}, here: () => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }), goTo: () => {}, showPins: () => {} });
  const radioRef = useRef<Radio | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const settingsRef = useRef(settings);
  const [showSettings, setShowSettings] = useState(false);
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  const [dismissed, setDismissed] = useState(false);
  const [ui, setUi] = useState<Ui>({ actions: [], doorOpen: false, near: [], target: null, hear: false, row: -1 });
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatText, setChatText] = useState("");
  const [bubbles, setBubbles] = useState<Record<string, string>>({}); // key ("me" for you) -> message over the head
  const [pings, setPings] = useState<{ key: string; label: string }[]>([]);
  const pingRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const chatEnd = useRef<HTMLDivElement>(null);
  const [music, setMusic] = useState<RadioState>({ queue: [], now: null });
  const [musicOpen, setMusicOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);
  const [found, setFound] = useState<Found[] | null>(null);
  const [kind, setKind] = useState<"video" | "playlist">("video");
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<string | null>(null);
  const [incomingMode, setIncomingMode] = useState<Mode>(MODES[0]);
  // everyone with a name tag: the test people plus real players online. key = name for test people, user id for players
  const [roster, setRoster] = useState<{ key: string; label: string; real: boolean }[]>(() => PEOPLE.map((p) => ({ key: p.name, label: p.name, real: false })));
  const label0 = (k: string) => roster.find((r) => r.key === k)?.label ?? k;
  const [more, setMore] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [, setSkyUi] = useState({ rain: false, wday: 0, hour: 12 });
  // dev pins: only the developer's account (or ?pins in local dev) can drop notes on spots that need fixing
  const isDev = account?.email?.toLowerCase() === CONTACT_EMAIL || (import.meta.env.DEV && new URLSearchParams(location.search).has("pins"));
  const [pins, setPins] = useState<Pin[]>([]);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinNote, setPinNote] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  useEffect(() => { if (isDev) loadPins().then(setPins); }, [isDev]);
  useEffect(() => { api.current.showPins(isDev ? pins : []); }, [pins, isDev]);
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

  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "end" }); }, [chatMsgs, chatOpen]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const host = hostRef.current!;
    const env = ENVS.storm;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(env.fog, 40, 320);
    const hemi = new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemi + 0.35);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(env.sun, env.sunI + 0.4);
    sun.position.set(...env.sunPos);
    scene.add(sun);
    // the sky follows the real clock (and the rain days); checked again every 20 s
    let sky: SkyNow = skyNow(), skyKey = "";
    const applySky = () => {
      sky = skyNow();
      const key = sky.sky.join();
      if (key !== skyKey) {
        skyKey = key;
        (scene.background as THREE.Texture | null)?.dispose?.();
        scene.background = skyTexture(sky.sky);
      }
      (scene.fog as THREE.Fog).color.setHex(sky.fog);
      (scene.fog as THREE.Fog).far = sky.rain ? 320 : 420 - sky.night * 80;
      hemi.color.setHex(sky.hemiSky);
      hemi.groundColor.setHex(sky.hemiGround);
      sun.color.setHex(sky.sun);
      sun.intensity = sky.sunI + 0.4;
      setSkyUi({ rain: sky.rain, wday: sky.wday, hour: sky.hour });
    };
    // the little weather screen by the sand-yard arena's south gate
    const wx = buildWeatherBoard(new THREE.Vector3(6.5, 9.25, 11.5), 0);
    scene.add(wx.root);
    const applySkyAll = () => { applySky(); wx.update(sky); };
    applySkyAll();
    const skyTimer = setInterval(applySkyAll, 20000);

    const citadel = buildArasaka(env);
    scene.add(citadel.root);
    const col = citadel.col;
    const outlines: THREE.Object3D[] = [];
    citadel.root.traverse((o) => { if ((o as THREE.LineSegments).isLineSegments) outlines.push(o); });
    // the ink outlines sit exactly on the faces they trace, so the two fought over every pixel and
    // flickered as the camera moved: push the faces a hair back so the lines always win
    citadel.root.traverse((o) => {
      const m = (o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).material as THREE.Material | THREE.Material[]) : null;
      for (const mat of m ? (Array.isArray(m) ? m : [m]) : []) if (!mat.transparent) { mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 1; }
    });

    /* ----- the world's shape, bucketed in a grid so each check only looks at nearby boxes ----- */
    const CELL = 10;
    const grid = new Map<string, { b: Box; kind: "walk" | "solid" | "door" | "roof"; door?: Door }[]>();
    const add = (b: Box, kind: "walk" | "solid" | "door" | "roof", door?: Door) => {
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
    col.roofs.forEach((b) => add(b, "roof"));

    const neon = buildNeon();
    scene.add(neon.root);
    const aura = buildAura();
    scene.add(aura.root);
    // two lights that follow you into whichever Keep room you're in, in that room's colours
    const roomA = new THREE.PointLight(0xffffff, 0, 22, 1.1), roomB = new THREE.PointLight(0xffffff, 0, 22, 1.1);
    scene.add(roomA, roomB);
    let inRoom: (typeof citadel.rooms)[number] | null = null;
    const markers = pinMarkers();
    scene.add(markers.root);
    api.current.showPins = markers.set;

    /* ----- the giant screen and its radio ----- */
    const board = new Billboard(host, BOARD_AT, BOARD_RY, BOARD_SIZE);
    scene.add(board.root);
    board.solid.forEach((b) => add(b, "solid"));
    wx.solid.forEach((b) => add(b, "solid"));
    const street = buildStreet();
    scene.add(street.root);
    street.solid.forEach((b) => add(b, "solid"));
    street.walk.forEach((b) => add(b, "walk"));
    const speakers = buildSpeakers(BOARD_AT, BOARD_RY);
    scene.add(speakers.root);
    speakers.solid.forEach((b) => add(b, "solid"));
    const benches = buildBenches(BOARD_AT, BOARD_RY);
    scene.add(benches.root);
    benches.walk.forEach((b) => add(b, "walk"));
    const radio = new Radio("arasaka", account?.id);
    radioRef.current = radio;
    const syncRadio = () => {
      setMusic({ queue: radio.state.queue.map((x) => ({ ...x })), now: radio.state.now });
      board.play(radio.state.now, radio.elapsed());
    };
    const unsub = radio.subscribe(syncRadio);
    syncRadio();
    let toldSkip = "";
    board.onEnded = (id, skip) => {
      const title = radio.state.now?.id === id ? radio.state.now.title : "That video";
      radio.ended(id, skip);
      if (skip && toldSkip !== id) {
        toldSkip = id;
        setToast(`${title}: its owner only lets it play on YouTube itself, so it was skipped.`);
      }
    };
    board.onBlocked = () => { setListening(false); setToast("Your phone stopped the sound. Tap Listen again."); };
    api.current.listen = (on) => { board.setListening(on); setListening(on); };
    api.current.progress = () => ({ t: radio.elapsed(), d: board.duration });
    const EMPTY: never[] = [];
    const cellAt = (x: number, z: number) => grid.get(Math.floor(x / CELL) + "," + Math.floor(z / CELL)) ?? EMPTY;
    const doorOpen = new Set<Box>();

    let trainRef: ReturnType<typeof buildTrain> | null = null;
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
      // standing on a lift platform
      for (const l of col.lifts) if (x > l.x0 && x < l.x1 && z > l.z0 && z < l.z1 && l.at <= y + STEP && l.at > best) best = l.at;
      // standing in a train car
      if (trainRef) best = Math.max(best, trainRef.floorAt(x, z, y, STEP));
      return best;
    };
    /* ----- the Thunder Line (built here, once the ground can be asked how high it is) ----- */
    const train = buildTrain((x, z, top) => floorAt(x, z, top));
    trainRef = train;
    scene.add(train.root);
    train.solid.forEach((b) => add(b, "solid"));
    train.walk.forEach((b) => add(b, "walk"));
    col.ramps.push(...train.ramps);
    col.lifts.push(...train.lifts);
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
        // lift gates are shut unless the platform stands at that floor
        for (const l of col.lifts) for (const g of l.gates) if (Math.abs(l.at - g.stop) > 0.3 && blocks(g.box, p.y)) test(g.box);
        // platform screen doors stay shut unless the train stands there with its doors open
        for (const g of train.gates) if (train.shut(g.station) && blocks(g.box, p.y)) test(g.box);
        for (const { b, kind } of cellAt(p.x, p.z)) {
          if (!blocks(b, p.y)) continue;
          if (kind === "solid" || (kind === "walk" && b.y1 > p.y + STEP) || (kind === "door" && !doorOpen.has(b))) test(b);
        }
      }
    };
    // the highest surface below y at (x, z): where rain lands
    const coverAt = (x: number, z: number, y: number) => {
      let best = groundAt(x, z);
      for (const { b } of cellAt(x, z)) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.y1 <= y && b.y1 > best) best = b.y1;
      return best;
    };
    // something overhead: a ceiling, an upper floor, a roof, the gate passage
    const indoors = (p: THREE.Vector3) => {
      for (const { b, kind } of cellAt(p.x, p.z)) if (kind !== "door" && p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1 && b.y0 > p.y + 1.9 && b.y0 < p.y + 40) return true;
      return false;
    };
    // for the camera: low things (railings, fences, parapets, benches) don't pull it in, it just looks over them
    const insideSolid = (v: THREE.Vector3) => {
      for (const { b, kind } of cellAt(v.x, v.z))
        if ((kind !== "solid" || b.y1 - b.y0 > 1.6) && v.x > b.x0 && v.x < b.x1 && v.z > b.z0 && v.z < b.z1 && v.y > b.y0 && v.y < b.y1 && (kind !== "door" || !doorOpen.has(b))) return true;
      return false;
    };

    /* ----- you ----- */
    const hero = new Hero();
    scene.add(hero.root);
    const pos = ARASAKA_SPAWN.clone();
    pos.y = groundAt(pos.x, pos.z);
    let facing = Math.PI; // toward the gate (-z)
    let vy = 0, grounded = true, running = false;
    let riding: Lift | null = null; // the lift you stand on

    /* ----- other people ----- */
    const people = PEOPLE.map((p) => {
      const h = new Hero(p.colors);
      const at = new THREE.Vector3(p.at[0], 0, p.at[1]);
      at.y = floorAt(at.x, at.z, 20);
      h.root.position.copy(at);
      scene.add(h.root);
      return { name: p.name as string, hero: h, pos: at, facing: 0, remote: false };
    });

    /* ----- real players online (signed in only) ----- */
    const online = account && supabase ? new Online("arasaka", { id: account.id, name: account.name }) : null;
    const syncRoster = () => {
      if (!online) return;
      for (let i = people.length - 1; i >= 0; i--) {
        const p = people[i];
        if (p.remote && !online.peers.has(p.name)) { scene.remove(p.hero.root); people.splice(i, 1); }
      }
      for (const peer of online.peers.values()) {
        if (people.some((p) => p.name === peer.id)) continue;
        const h = new Hero(lookFor(peer.id));
        h.root.visible = false; // until we hear where they are
        scene.add(h.root);
        people.push({ name: peer.id, hero: h, pos: new THREE.Vector3(), facing: 0, remote: true });
      }
      setRoster([...PEOPLE.map((p) => ({ key: p.name as string, label: p.name as string, real: false })), ...[...online.peers.values()].map((p) => ({ key: p.id, label: shortName(p.name), real: true }))]);
      uiKey = "";
    };
    if (online) {
      online.onRoster = syncRoster;
      online.onChallenge = (from, mode) => {
        setIncomingMode(MODES.find((m) => m.id === mode) ?? MODES[0]);
        setIncoming(from);
      };
      online.onAnswer = (from, mode, ok) => {
        const m = MODES.find((x) => x.id === mode) ?? MODES[0];
        const who = shortName(online.peers.get(from)?.name ?? "They");
        setToast(ok ? `${who} accepted your ${m.name} challenge. Real camera battles from the world come next.` : `${who} declined your challenge.`);
      };
      api.current.challenge = (key, mode) => { if (!online.peers.has(key)) return false; online.challenge(key, mode); return true; };
      api.current.answer = (key, mode, ok) => { if (!online.peers.has(key)) return false; online.answer(key, mode, ok); return true; };
    }

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
    if (import.meta.env.DEV) (window as unknown as { __ex: unknown }).__ex = { pos, train, cam: (a: number[] | null) => (camOverride = a), floor: floorAt, lifts: col.lifts, face: (a: number) => (facing = a), yaw: (a: number) => (yaw = a, pitch = 0.15), look: (a: number, b: number) => ((yaw = a), (pitch = b)), doors: () => col.doors.map((d) => d.open) };

    let camOverride: number[] | null = null; // dev: a fixed camera [x, y, z, lookX, lookY, lookZ]
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
    let yaw = 0, pitch = settingsRef.current.view === "first" ? 0.02 : 0.3; // camera sits behind (at +z of) the hero to start
    api.current.here = () => ({ x: pos.x, y: pos.y, z: pos.z, yaw, pitch });
    api.current.goTo = (p) => { if (seat) return; trainRef?.drop(); pos.set(p.x, p.y + 0.05, p.z); vy = 0; yaw = p.yaw; pitch = p.pitch; facing = p.yaw + Math.PI; };
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
    let look: { id: number; x: number; y: number; x0: number; y0: number; t0: number } | null = null;
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
      if ((target as HTMLElement | null)?.closest?.("button, input, a, .ex-pop, .ex-modes, .ex-lock, .ex-settings, .ex-music, .ex-np, .ex-chat")) return;
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
      } else if (!look) look = { id, x, y, x0: x, y0: y, t0: performance.now() };
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
      if (look && id === look.id) {
        // a quick tap (not a drag) on your own character sends the call
        if (Math.hypot(look.x - look.x0, look.y - look.y0) < 10 && performance.now() - look.t0 < 350) tapAt(look.x0, look.y0);
        look = null;
      }
    };
    // touch events: the most reliable way to follow two thumbs at once on iPhone
    const UI = "button, input, a, .ex-pop, .ex-modes, .ex-lock, .ex-settings, .ex-music, .ex-np, .ex-chat";
    const ts = (e: TouchEvent) => {
      if (!(e.target as HTMLElement).closest?.(UI)) e.preventDefault(); // no page scroll, zoom or long-press menu
      for (const t of Array.from(e.changedTouches)) start(t.identifier, t.clientX, t.clientY, t.target);
    };
    const tm = (e: TouchEvent) => {
      if (!(e.target as HTMLElement).closest?.(".ex-settings, .ex-music, .ex-chat")) e.preventDefault();
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
      if (seat) { standUp(); return; }
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
      else if (a === "music") setMusicOpen((v) => !v);
      else if (a === "sit" && nearSeat) sitDown(nearSeat);
      else if (a === "chat") setChatOpen(true);
    };
    api.current.lock = (name) => { locked = name; uiKey = ""; };
    let challenger: string | null = null, nextChallenge = 8, nearTime = 0;
    api.current.challenged = (name) => {
      challenger = name;
      if (!name) nextChallenge = 45;
    };
    api.current.wave = () => hero.wave();

    /* ----- benches: sit, stand, chat with your row ----- */
    let seat: Seat | null = null, nearSeat: Seat | null = null;
    const sitDown = (st: Seat) => {
      seat = st;
      yaw = st.facing - Math.PI; // look the way the seat faces (at the big screen)
      pitch = -0.05;
      speed = 0;
      uiKey = "";
      setChatMsgs([]);
    };
    const standUp = () => {
      if (!seat) return;
      // step off toward the screen, into the gap between rows
      pos.set(seat.pos.x + Math.sin(seat.facing) * 0.9, seat.pos.y, seat.pos.z + Math.cos(seat.facing) * 0.9);
      seat = null;
      uiKey = "";
      setChatOpen(false);
    };
    const MY_KEY = account?.id ?? "me";
    const bubble = (k: string, text: string) => {
      setBubbles((b) => ({ ...b, [k]: text }));
      setTimeout(() => setBubbles((b) => {
        if (b[k] !== text) return b;
        const rest = { ...b };
        delete rest[k];
        return rest;
      }), 6000);
    };
    api.current.chat = (text) => {
      if (!seat) return;
      const name = myName;
      setChatMsgs((m) => [...m.slice(-80), { key: "me", name, text, mine: true, at: Date.now() }]);
      bubble("me", text);
      online?.chat(seat.row, text);
    };
    if (online)
      online.onChat = (from, row, text) => {
        if (!seat || seat.row !== row) return; // only your row hears it
        const name = shortName(online.peers.get(from)?.name ?? "Player");
        setChatMsgs((m) => [...m.slice(-80), { key: from, name, text, mine: false, at: Date.now() }]);
        bubble(from, text);
      };

    /* ----- the call: tap your character ----- */
    const pingAt = new Map<string, { pos: THREE.Vector3; until: number }>();
    const rings: { mesh: THREE.Mesh; t: number }[] = [];
    const ripple = (at: THREE.Vector3) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
      m.position.copy(at).setY(at.y + 0.08);
      scene.add(m);
      rings.push({ mesh: m, t: 0 });
    };
    let lastCall = 0;
    const call = () => {
      if (performance.now() - lastCall < 1200) return;
      lastCall = performance.now();
      playChime(MY_KEY);
      hero.call();
      ripple(pos);
      online?.call(pos.x, pos.y, pos.z);
    };
    if (online)
      online.onCall = (from, at) => {
        const p3 = new THREE.Vector3(at.x, at.y, at.z);
        playChime(from, Math.max(0.3, 1 - p3.distanceTo(pos) / 160));
        people.find((p) => p.name === from)?.hero.call();
        ripple(p3);
        pingAt.set(from, { pos: p3, until: performance.now() + 7000 });
        const label = shortName(online.peers.get(from)?.name ?? "Player");
        setPings((l) => [...l.filter((x) => x.key !== from), { key: from, label }]);
      };
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const tapAt = (x: number, y: number) => {
      unlockChime();
      const r = host.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (hero.root.visible && ray.intersectObject(hero.root, true).length) call();
    };

    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea")) return; // typing a song link
      const k = e.key.toLowerCase();
      keys.add(k);
      if (k === " ") jump();
      if (k === "e") api.current.act(nearDoor ? "door" : nearSeat ? "sit" : "battle");
      if (k === "c") call();
    };
    const ku = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    /* ----- rain around the hero, lightning ----- */
    const RAIN = 900;
    const rp = new Float32Array(RAIN * 6);
    const land = new Float32Array(RAIN); // each drop stops on the first roof or floor under it
    const drop = (i: number, top = false) => {
      const x = pos.x + (Math.random() - 0.5) * 60, z = pos.z + (Math.random() - 0.5) * 60, sky = pos.y + 30;
      land[i] = coverAt(x, z, sky);
      const y = top ? sky : land[i] + Math.random() * Math.max(0, sky - land[i]);
      rp.set([x, y, z, x + 0.15, y + 0.9, z], i * 6);
    };
    for (let i = 0; i < RAIN; i++) drop(i);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(rp, 3));
    const rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xa9b8cc, transparent: true, opacity: 0.4 }));
    rain.frustumCulled = false;
    scene.add(rain);
    let nextFlash = 3, flashT = -1, inAir = 1;

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
    // get every shader and texture onto the GPU now, not the first time it comes into view: that
    // first-sight upload is what made the picture hitch while turning (and settle once you stopped)
    renderer.compile(scene, camera);
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const mat of m ? (Array.isArray(m) ? m : [m]) : []) for (const k of ["map", "emissiveMap", "alphaMap"] as const) {
        const t = (mat as THREE.MeshStandardMaterial)[k];
        if (t) renderer.initTexture(t);
      }
    });
    renderer.setAnimationLoop(() => {
      // a slow frame moves you further instead of slowing the world down (up to a 10 fps hiccup)
      const dt = Math.min(0.1, clock.getDelta());
      if (document.hidden) return;
      const t = clock.elapsedTime;
      const S = settingsRef.current;
      applyQuality();
      rain.visible = S.quality !== "low" && sky.rain;

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
      if (seat && amt > 0.3) standUp(); // push the stick to get up
      const wantSpeed = amt === 0 || seat ? 0 : (run ? RUN : WALK * (0.35 + 0.65 * amt)) * S.speed;
      speed += (wantSpeed - speed) * Math.min(1, dt * (grounded ? 10 : 2.5));
      const fp = S.view === "first";
      if (fp && !seat) facing = yaw + Math.PI; // in first person your body turns with your eyes
      const heading = fp && amt > 0 ? Math.atan2(move.x, move.z) : facing;
      if (amt > 0 && !seat && !fp) {
        let d = Math.atan2(move.x, move.z) - facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        facing += d * Math.min(1, dt * (S.stick === "snappy" ? 20 : 13));
      }
      // a train car you stand in carries you (and turns your view with it)
      train.update();
      if (!seat) yaw += train.carry(pos);
      // move in small sub-steps so fast running never skips through a wall
      const total = speed * dt, n = Math.max(1, Math.ceil(total / (R * 0.7)));
      for (let i = 0; i < n; i++) {
        pos.x += (Math.sin(heading) * total) / n;
        pos.z += (Math.cos(heading) * total) / n;
        collide(pos);
        train.confine(pos);
        for (const p of people) {
          if (!p.hero.root.visible) continue;
          const rx = pos.x - p.pos.x, rz = pos.z - p.pos.z, rd = Math.hypot(rx, rz);
          if (rd < 2 * R && Math.abs(pos.y - p.pos.y) < 1.5 && rd > 1e-4) { pos.x = p.pos.x + (rx / rd) * 2 * R; pos.z = p.pos.z + (rz / rd) * 2 * R; }
        }
      }
      pos.x = THREE.MathUtils.clamp(pos.x, -230, 230);
      pos.z = THREE.MathUtils.clamp(pos.z, -170, 240);

      // gravity, jumping, and standing on the highest floor within a step (sitting: stay put on the seat)
      if (seat) { pos.copy(seat.pos); facing = seat.facing; vy = 0; grounded = true; }
      else {
        // riding a lift: move with the platform, however far it went this frame
        if (riding && grounded && pos.x > riding.x0 && pos.x < riding.x1 && pos.z > riding.z0 && pos.z < riding.z1) pos.y = riding.at;
        vy -= GRAVITY * dt;
        pos.y += vy * dt;
        const floor = floorAt(pos.x, pos.z, pos.y + Math.max(0, -vy * dt));
        if (pos.y <= floor + 0.02 || (grounded && pos.y - floor < STEP && vy <= 0)) { pos.y = floor; vy = 0; grounded = true; }
        else grounded = false;
        riding = grounded ? col.lifts.find((l) => Math.abs(l.at - pos.y) < 0.01 && pos.x > l.x0 && pos.x < l.x1 && pos.z > l.z0 && pos.z < l.z1) ?? null : null;
      train.remember(pos, grounded);
      }

      // the closest free seat within reach
      nearSeat = null;
      if (!seat && Math.hypot(pos.x - board.center.x, pos.z - board.center.z) < 50) {
        const taken = new Set<number>();
        online?.peers.forEach((p) => { if (p.seat >= 0) taken.add(p.seat); });
        let bd = 1.7;
        for (const st of benches.seats) {
          const d = Math.hypot(st.pos.x - pos.x, st.pos.z - pos.z);
          if (d < bd && !taken.has(st.i) && Math.abs(st.pos.y - pos.y) < 1) { bd = d; nearSeat = st; }
        }
      }

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
        if (p.remote) {
          // real players: glide toward where they last said they were
          const peer = online?.peers.get(p.name);
          if (!peer || Number.isNaN(peer.x)) continue;
          if (!p.hero.root.visible || Math.hypot(peer.x - p.pos.x, peer.z - p.pos.z) > 12) p.pos.set(peer.x, peer.y, peer.z);
          else p.pos.lerp(v.set(peer.x, peer.y, peer.z), Math.min(1, dt * 10));
          let a = peer.f - p.facing;
          a = Math.atan2(Math.sin(a), Math.cos(a));
          p.facing += a * Math.min(1, dt * 12);
          p.hero.root.visible = true;
          p.hero.root.position.copy(p.pos);
          p.hero.root.rotation.y = p.facing;
          p.hero.animate(peer.s, dt, t, peer.air, peer.seat >= 0);
        }
        if (!p.hero.root.visible) continue;
        const d = Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z);
        if (!p.remote && d < 14) {
          let a = Math.atan2(pos.x - p.pos.x, pos.z - p.pos.z) - p.facing;
          a = Math.atan2(Math.sin(a), Math.cos(a));
          p.facing += a * Math.min(1, dt * 4);
        }
        if (!p.remote) {
          p.hero.root.rotation.y = p.facing;
          p.hero.animate(0, dt, t + p.pos.x);
        }
        if (d < BATTLE_RANGE && Math.abs(pos.y - p.pos.y) < 2) near.push(p);
        if (!p.remote && d < 18 && (!nearest18 || d < Math.hypot(pos.x - nearest18.pos.x, pos.z - nearest18.pos.z))) nearest18 = p;
      }
      near.sort((a, b) => Math.hypot(pos.x - a.pos.x, pos.z - a.pos.z) - Math.hypot(pos.x - b.pos.x, pos.z - b.pos.z));
      if (locked && !near.some((p) => p.name === locked)) locked = null;
      const target = near.length ? (locked ?? near[0].name) : null;

      // now and then someone near challenges you
      if (nearest18 && !challenger) {
        nearTime += dt;
        nextChallenge -= dt;
        if (nearTime > 4 && nextChallenge <= 0) { challenger = nearest18.name; setIncomingMode(MODES[0]); setIncoming(challenger); }
      } else if (!nearest18) nearTime = 0;

      // which buttons to show
      const actions: Action[] = [];
      const boardD = Math.hypot(pos.x - board.center.x, pos.z - board.center.z);
      if (nearDoor) actions.push("door");
      if (near.length) actions.push("battle");
      if (seat) actions.push("chat");
      else if (nearSeat) actions.push("sit");
      if (boardD < RADIO_RANGE) actions.push("music");
      if (near.length) actions.push("more");
      const loud = loudness(pos, speakers.loudAt(pos));
      const hear = loud > 0.05;
      const row = seat ? seat.row : -1;
      const key = actions.join() + (nearDoor && nearDoor.target > 0.5 ? "o" : "") + near.map((p) => p.name).join() + "|" + target + hear + row;
      if (key !== uiKey) {
        uiKey = key;
        setUi({ actions, doorOpen: !!nearDoor && nearDoor.target > 0.5, near: near.map((p) => p.name), target, hear, row });
      }

      hero.root.position.copy(pos);
      hero.root.rotation.y = facing;
      hero.animate(speed, dt, t, !grounded, !!seat);
      online?.send(pos.x, pos.y, pos.z, facing, speed, !grounded, seat ? seat.i : -1);
      citadel.tick(t, dt);
      const room = citadel.rooms.find((r) => pos.x > r.box.x0 && pos.x < r.box.x1 && pos.z > r.box.z0 && pos.z < r.box.z1 && pos.y > r.box.y0 - 0.5 && pos.y < r.box.y1 - 0.5) ?? null;
      if (room !== inRoom) {
        inRoom = room;
        if (room) { roomA.color.setHex(room.a); roomB.color.setHex(room.b); roomA.position.copy(room.pa); roomB.position.copy(room.pb); }
      }
      roomA.intensity = room ? 6 : 0;
      roomB.intensity = room ? 4.5 : 0;
      neon.tick(t, dt, pos);
      aura.tick(t, dt, sky.night);

      // third-person camera behind the hero, pulled in if a wall is in the way.
      // Below zero pitch the camera drops low behind you so you can look up at the sky.
      head.set(pos.x, pos.y + 1.55, pos.z);
      const dist = fp ? 0 : 5.4;
      dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      hero.root.visible = !fp;
      // first person: eyes at head height (lower when sitting), a little forward of the neck
      if (fp) head.set(pos.x - dir.x * 0.15, pos.y + (seat ? 1.2 : 1.6), pos.z - dir.z * 0.15);
      let reach = dist;
      for (let s = 0.4; s <= dist; s += 0.3) {
        probe.copy(head).addScaledVector(dir, s);
        if (insideSolid(probe)) { reach = Math.max(0.6, s - 0.4); break; }
      }
      camPos.copy(head).addScaledVector(dir, reach);
      if (!fp) camPos.y = Math.max(camPos.y, floorAt(camPos.x, camPos.z, pos.y + 1) + 0.3);
      if (first || fp) { camera.position.copy(camPos); first = false; } // no swoop in from the middle of the citadel
      else camera.position.lerp(camPos, Math.min(1, dt * 16));
      look3.copy(camPos).addScaledVector(dir, -20);
      camera.lookAt(look3);
      if (camOverride) { camera.position.set(camOverride[0], camOverride[1], camOverride[2]); camera.lookAt(camOverride[3], camOverride[4], camOverride[5]); }

      if (fp) { if (youRef.current) youRef.current.style.opacity = "0"; } else tag(youRef.current, pos, seat ? 1.7 : 2.05);
      for (const p of people) tag(tagRefs.current[p.name], p.pos, (online?.peers.get(p.name)?.seat ?? -1) >= 0 ? 1.7 : 2.05);

      // call pings: where the caller is, shown through walls, pinned to the screen edge when out of view
      const W = host.clientWidth, Hh = host.clientHeight;
      for (const [k, pg] of pingAt) {
        const node = pingRefs.current[k];
        if (performance.now() > pg.until) { pingAt.delete(k); setPings((l) => l.filter((x) => x.key !== k)); continue; }
        if (!node) continue;
        v.copy(pg.pos).setY(pg.pos.y + 2.4).project(camera);
        let x = v.x, y = -v.y;
        const behind = v.z > 1;
        if (behind) { x = -x; y = -y; }
        const off = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.85;
        if (off) { const m = Math.max(Math.abs(x) / 0.88, Math.abs(y) / 0.78); x /= m; y /= m; }
        node.classList.toggle("edge", off);
        node.style.transform = `translate(${((x * 0.5 + 0.5) * W).toFixed(1)}px, ${((y * 0.5 + 0.5) * Hh).toFixed(1)}px) translate(-50%, -50%)`;
        const arrow = node.firstElementChild as HTMLElement | null;
        if (arrow) arrow.style.transform = `rotate(${Math.atan2(y, x)}rad)`;
        const meters = node.lastElementChild as HTMLElement | null;
        if (meters) meters.textContent = `${Math.round(pg.pos.distanceTo(pos))} m`;
      }
      // the ripple round a caller
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.t += dt;
        r.mesh.scale.setScalar(1 + r.t * 9);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 - r.t * 0.8);
        if (r.t > 1) { scene.remove(r.mesh); r.mesh.geometry.dispose(); (r.mesh.material as THREE.Material).dispose(); rings.splice(i, 1); }
      }

      // rain follows the hero
      if (rain.visible) {
        for (let i = 0; i < RAIN; i++) {
          const o = i * 6;
          rp[o + 1] -= dt * 28;
          rp[o + 4] -= dt * 28;
          rp[o] -= dt * 4;
          rp[o + 3] -= dt * 4;
          if (rp[o + 1] < land[i] || Math.abs(rp[o] - pos.x) > 32 || Math.abs(rp[o + 2] - pos.z) > 32) drop(i, true);
        }
        rg.attributes.position.needsUpdate = true;
      }

      nextFlash -= dt;
      if (nextFlash <= 0) { if (sky.rain) flashT = 0; nextFlash = 5 + Math.random() * 8; }
      let f = 0;
      if (flashT >= 0) {
        flashT += dt;
        f = flashT < 0.08 ? 1 : flashT < 0.16 ? 0.25 : flashT < 0.26 ? 0.8 : Math.max(0, 1 - (flashT - 0.26) * 4);
        if (flashT > 0.6) flashT = -1;
      }
      // indoors you only catch a little of the flash through the windows
      const inside = indoors(pos);
      inAir += ((inside ? 0 : 1) - inAir) * Math.min(1, dt * 3);
      hemi.intensity = sky.hemi + 0.35 + f * 2.5 * (0.15 + 0.85 * inAir);
      if (flashRef.current) flashRef.current.style.opacity = String(f * 0.4 * inAir);

      renderer.render(scene, camera);
      speakers.tick(t, !!radio.state.now);
      street.tick();
      board.tick(camera, host.clientWidth, host.clientHeight, loudness(pos, speakers.loudAt(pos)), radio.elapsed(), dt);
    });

    return () => {
      clearInterval(skyTimer);
      renderer.setAnimationLoop(null);
      ro.disconnect();
      unsub();
      radio.close();
      online?.close();
      radioRef.current = null;
      board.dispose();
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
  const startBattle = (key: string, mode: Mode, from: "you" | "them") => {
    const who = label0(key);
    setPicker(null);
    setIncoming(null);
    api.current.challenged(null);
    // a real player gets the challenge on their phone; the test people answer straight away
    if (from === "you" && api.current.challenge(key, mode.id)) { setToast(`Challenge sent to ${who}…`); return; }
    if (from === "them") api.current.answer(key, mode.id, true);
    setToast(
      from === "you"
        ? `${who} accepted your ${mode.name} challenge (${mode.time}, ${mode.bet} Respect). In the real game the camera battle starts here.`
        : `You accepted ${who}'s ${mode.name} challenge. In the real game the camera battle starts here.`,
    );
  };
  const decline = (key: string) => {
    setIncoming(null);
    api.current.challenged(null);
    api.current.answer(key, incomingMode.id, false);
  };
  const set = <K extends keyof Settings>(k: K, val: Settings[K]) => setSettings((s) => ({ ...s, [k]: val }));
  const main = ui.actions.filter((a) => a !== "more");
  const multi = main.length > 1;
  const arc: Action = (["battle", "door", "sit", "chat", "music"] as const).find((a) => ui.actions.includes(a)) ?? "battle";
  const label = (a: Action) =>
    a === "door" ? (ui.doorOpen ? "Close door" : "Open door") : a === "battle" ? "Battle" : a === "music" ? "Radio" : a === "sit" ? "Sit" : a === "chat" ? "Chat" : "More";
  const sendChat = () => {
    const t = chatText.trim();
    if (!t) return;
    api.current.chat(t.slice(0, 200));
    setChatText("");
  };
  const meId = radioRef.current?.myId ?? "";
  const queue = [...music.queue].sort((a, b) => b.votes.length - a.votes.length);
  const suggest = (list: { id: string; title: string }[]) => {
    if (!list.length) return;
    radioRef.current?.suggest(list, myName);
    if (!listening) api.current.listen(true); // you picked a song, so you want to hear it
  };
  const addPlaylist = async (id: string) => {
    if (!canSearch) { setToast("Playlists need the YouTube key set up first."); return; }
    setAdding(true);
    try {
      const songs = await playlistSongs(id);
      suggest(songs);
      setToast(`Added ${songs.length} songs from the playlist.`);
    } catch (e) {
      setToast((e as Error).message);
    }
    setAdding(false);
  };
  // the box takes a song link, a playlist link, or words to search for
  const go = async () => {
    const text = link.trim();
    if (!text || adding) return;
    const list = playlistId(text), vid = videoId(text);
    if (vid) {
      setAdding(true);
      suggest([{ id: vid, title: await videoTitle(vid) }]);
      setAdding(false);
      setLink("");
    } else if (list) {
      await addPlaylist(list);
      setLink("");
    } else if (!canSearch) setToast("Search needs the YouTube key set up first. Paste a link for now.");
    else {
      setAdding(true);
      try {
        setFound(await search(text, kind));
      } catch (e) {
        setToast((e as Error).message);
      }
      setAdding(false);
    }
  };
  const dropPin = async () => {
    const note = pinNote.trim();
    if (!note || pinBusy) return;
    setPinBusy(true);
    const p = await addPin({ ...api.current.here(), note });
    setPins((l) => [...l, p]);
    setPinNote("");
    setPinBusy(false);
    setToast(p.id.startsWith("local-") ? "Pinned on this phone only. Run world-pins.sql in Supabase so pins are saved for good." : `Pin #${pins.length + 1} saved.`);
  };
  const copyPins = async () => {
    try {
      await navigator.clipboard.writeText(pinsText(pins));
      setToast("All pins copied. Paste them to Claude.");
    } catch {
      setToast("Couldn't copy here. Long-press the list to select it instead.");
    }
  };
  const isLink = !!(videoId(link) || playlistId(link));
  const pointed = incoming ?? ui.target; // who the red triangle points at

  return (
    <div className="ex" ref={hostRef}>
      <div ref={flashRef} className="lightning-flash" />

      <div ref={youRef} className="ex-tag you">
        {bubbles.me && <span className="ex-bubble">{bubbles.me}</span>}
        {myName} (you)
      </div>
      {roster.map((p) => (
        <div key={p.key} ref={(n) => { tagRefs.current[p.key] = n; }} className={`ex-tag ${p.real ? "real" : ""} ${pointed === p.key ? "pointed" : ""}`}>
          {bubbles[p.key] && <span className="ex-bubble">{bubbles[p.key]}</span>}
          <i className="ex-arrow" />
          {p.label}
        </div>
      ))}
      {pings.map((pg) => (
        <div key={pg.key} ref={(n) => { pingRefs.current[pg.key] = n; }} className="ex-ping">
          <i />
          <b>{pg.label}</b>
          <span />
        </div>
      ))}

      <header className="ex-top">
        <button className="wm-round" onClick={onBack} aria-label="Back">‹</button>
        <div className="ex-crest">
          <ClanLogo clan={clan} size={30} />
          <span>Arasaka</span>
        </div>
        {isDev && (
          <button className="wm-round ex-pin-btn" onClick={() => setPinOpen((o) => !o)} aria-label="Dev pins">
            <svg viewBox="0 0 24 24"><path d="M12 22s-7-7.2-7-12a7 7 0 1 1 14 0c0 4.8-7 12-7 12Z" /><circle cx="12" cy="10" r="2.6" /></svg>
            {pins.filter((p) => !p.done).length > 0 && <i>{pins.filter((p) => !p.done).length}</i>}
          </button>
        )}
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
            <button key={n} className={`ex-face ${ui.target === n ? "on" : ""}`} onPointerUp={() => api.current.lock(n)} aria-label={`Target ${label0(n)}`}>
              {avatars[n] ? <img src={avatars[n]} alt="" /> : <b>{label0(n)[0]}</b>}
              <span>{label0(n)}</span>
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
          {/* tap: leap up (chevrons up); held: sprint (chevrons forward) */}
          <svg className="ic-jump" viewBox="0 0 40 40" aria-hidden>
            <path d="M10 21 20 11l10 10" />
            <path className="lo" d="M12 30 20 22l8 8" />
          </svg>
          <svg className="ic-run" viewBox="0 0 40 40" aria-hidden>
            <path d="M12 10l10 10-10 10" />
            <path className="lo" d="M21 13l7 7-7 7" />
          </svg>
          <em>Jump · hold run</em>
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
                {a === "sit" && <svg viewBox="0 0 24 24"><path d="M5 11h14M6 11v8M18 11v8M5 15h14M7 11V6h10v5" /></svg>}
                {a === "chat" && <svg viewBox="0 0 24 24"><path d="M4 5h16v10H9l-5 4z" /></svg>}
                {a === "music" && <svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>}
                {a === "more" && <svg viewBox="0 0 24 24"><path d="M6 12h.01M12 12h.01M18 12h.01" /></svg>}
                <span>{label(a)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {pinOpen && (
        <div className="ex-pins" onPointerDown={(e) => e.stopPropagation()}>
          <div className="ex-pins-head">
            <b>Dev pins</b>
            <button onClick={() => setPinOpen(false)} aria-label="Close">✕</button>
          </div>
          <p className="ex-pins-tip">Stand where the problem is, look at it, write what's wrong and tap Pin here.</p>
          <textarea value={pinNote} onChange={(e) => setPinNote(e.target.value)} placeholder="e.g. stair floats, room too dark, sword looks bad" rows={2} />
          <div className="ex-pins-row">
            <button className="ex-pins-go" disabled={!pinNote.trim() || pinBusy} onClick={dropPin}>Pin here</button>
            <button className="ex-pins-copy" disabled={!pins.length} onClick={copyPins}>Copy all</button>
          </div>
          <ol className="ex-pins-list">
            {pins.map((p, i) => (
              <li key={p.id} className={p.done ? "done" : ""}>
                <span className="n">{i + 1}</span>
                <span className="t">{p.note}</span>
                <button onClick={() => { api.current.goTo(p); setPinOpen(false); }}>Go</button>
                <button onClick={() => { updatePin(p.id, { done: !p.done }); setPins((l) => l.map((q) => (q.id === p.id ? { ...q, done: !q.done } : q))); }}>{p.done ? "Undo" : "Fixed"}</button>
                <button onClick={() => { if (confirm("Delete this pin?")) { deletePin(p.id); setPins((l) => l.filter((q) => q.id !== p.id)); } }}>✕</button>
              </li>
            ))}
            {!pins.length && <li className="empty">No pins yet.</li>}
          </ol>
        </div>
      )}

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
            <div className="ex-modes-title">Challenge {label0(picker)}</div>
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
            <div className="ex-pop-name">{label0(incoming)}</div>
          </div>
          <div className="ex-pop-card">
            <div className="ex-pop-label">challenges you · {incomingMode.name}</div>
            <div className="ex-pop-row">
              <button className="ok" aria-label="Accept" onPointerUp={() => startBattle(incoming, incomingMode, "them")}>
                <svg viewBox="0 0 24 24"><path d="M4 13l5 5L20 6" /></svg>
              </button>
              <button className="no" aria-label="Decline" onPointerUp={() => decline(incoming)}>
                <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* now playing, while you can hear the billboard */}
      {ui.hear && music.now && !musicOpen && (
        <div className="ex-np">
          <img src={thumb(music.now.id)} alt="" />
          <div className="ex-np-text">
            <b>{music.now.title}</b>
            <span>picked by {music.now.by}</span>
          </div>
          <button className={`ex-np-btn ${listening ? "on" : ""}`} onClick={() => api.current.listen(!listening)}>{listening ? "Mute" : "Listen"}</button>
        </div>
      )}

      {/* the song list: paste a link to suggest, tap a heart to vote; the most votes plays next */}
      {musicOpen && (
        <div className="ex-music yt">
          <div className="ex-music-head">
            <b><span className="yt-logo" aria-hidden><svg viewBox="0 0 28 20"><rect width="28" height="20" rx="5" /><path d="M11 6l7 4-7 4z" /></svg></span>Arasaka Radio</b>
            <button className="yt-x" onClick={() => setMusicOpen(false)} aria-label="Close">×</button>
          </div>
          <form className="yt-search" onSubmit={(e) => { e.preventDefault(); go(); }}>
            <input type="search" enterKeyHint={isLink ? "done" : "search"} value={link} onChange={(e) => setLink(e.target.value)} placeholder={canSearch ? "Search" : "Paste a YouTube link"} autoCapitalize="off" autoCorrect="off" />
            <button disabled={!link.trim() || adding} aria-label={isLink || !canSearch ? "Add" : "Search"}>
              {adding ? "…" : isLink || !canSearch ? "+" : <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /></svg>}
            </button>
          </form>
          {canSearch && (
            <div className="yt-chips">
              {found && <button onClick={() => setFound(null)}>Up next</button>}
              <button className={kind === "video" ? "on" : ""} onClick={() => { setKind("video"); setFound(null); }}>Videos</button>
              <button className={kind === "playlist" ? "on" : ""} onClick={() => { setKind("playlist"); setFound(null); }}>Playlists</button>
            </div>
          )}
          <div className="ex-music-list">
            {!found && (music.now ? (
              <div className="yt-now">
                <div className="yt-thumb big">
                  <img src={thumb(music.now.id)} alt="" />
                  <span className="yt-live">ON SCREEN</span>
                  <YtProgress get={api.current.progress} />
                </div>
                <b className="yt-title">{music.now.title}</b>
                <div className="yt-meta-row">
                  <em>picked by {music.now.by}</em>
                  <button className={`yt-pill ${listening ? "" : "hot"}`} onClick={() => api.current.listen(!listening)}>{listening ? "Mute" : "Listen"}</button>
                </div>
              </div>
            ) : (
              <p className="ex-note">Nothing on the screen yet. Search or paste a link and it plays.</p>
            ))}
            {found && found.length === 0 && <p className="ex-note">Nothing found.</p>}
            {found?.map((f) => {
              const queued = f.kind === "video" && (music.queue.some((q) => q.id === f.id) || music.now?.id === f.id);
              return (
                <div key={f.id} className="yt-row">
                  <div className="yt-thumb"><img src={f.thumb} alt="" />{f.kind === "playlist" && <span className="yt-badge">Playlist</span>}</div>
                  <div className="yt-text">
                    <b>{f.title}</b>
                    <em>{f.channel}</em>
                  </div>
                  <button className={`yt-add ${queued ? "on" : ""}`} disabled={queued || adding} onClick={() => (f.kind === "video" ? suggest([{ id: f.id, title: f.title.slice(0, 90) }]) : addPlaylist(f.id))} aria-label="Add">
                    {queued ? "✓" : "+"}
                  </button>
                </div>
              );
            })}
            {!found && <div className="yt-h">Up next{queue.length ? <span>{queue.length}</span> : null}</div>}
            {!found && queue.length === 0 && <p className="ex-note">Nothing waiting. The most liked plays next, and when the list is empty earlier videos come round again.</p>}
            {!found && queue.map((q) => {
              const mine = q.votes.includes(meId);
              return (
                <div key={q.id} className="yt-row">
                  <div className="yt-thumb"><img src={thumb(q.id)} alt="" /></div>
                  <div className="yt-text">
                    <b>{q.title}</b>
                    <em>by {q.by}</em>
                  </div>
                  <button className={`yt-like ${mine ? "on" : ""}`} onClick={() => radioRef.current?.vote(q.id, !mine)} aria-label={mine ? "Take back like" : "Like"}>
                    <svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9zM7 11l4-8c1.7 0 2.6 1.2 2.3 2.8L12.8 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7" /></svg>
                    {q.votes.length}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* bench chat: only the people sitting in your row see it; nothing is saved */}
      {chatOpen && ui.row >= 0 && (
        <div className="ex-chat">
          <div className="ex-music-head">
            <b>Row {ui.row + 1} chat</b>
            <button className="wm-round small" onClick={() => setChatOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="ex-chat-list">
            {chatMsgs.length === 0 && <p className="ex-note">Say hi to everyone sitting in your row. Messages vanish when you stand up.</p>}
            {chatMsgs.map((m, i) => (
              <div key={m.at + "-" + i} className={`ex-msg ${m.mine ? "mine" : ""}`}>
                {!m.mine && <b>{m.name}</b>}
                <span>{m.text}</span>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          <form className="ex-music-add" onSubmit={(e) => { e.preventDefault(); sendChat(); }}>
            <input id="ex-chat-in" value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Message your row" maxLength={200} autoComplete="off" enterKeyHint="send" />
            <button className="game-btn jade" disabled={!chatText.trim()}>Send</button>
          </form>
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
              <span>Camera</span>
              <div className="ex-seg">
                <button className={settings.view === "first" ? "on" : ""} onClick={() => set("view", "first")}>First person</button>
                <button className={settings.view === "third" ? "on" : ""} onClick={() => set("view", "third")}>Third person</button>
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

// the red bar under the now-playing picture, like YouTube's
function YtProgress({ get }: { get: () => { t: number; d: number } }) {
  const [p, setP] = useState(get);
  useEffect(() => {
    const id = setInterval(() => setP(get()), 1000);
    return () => clearInterval(id);
  }, [get]);
  const clock = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;
  const t = p.d ? Math.min(p.t, p.d) : p.t;
  return (
    <>
      <span className="yt-time">{clock(t)}{p.d ? ` / ${clock(p.d)}` : ""}</span>
      <div className="yt-bar"><i style={{ width: p.d ? `${(100 * t) / p.d}%` : "0%" }} /></div>
    </>
  );
}
