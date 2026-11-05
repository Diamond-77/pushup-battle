import * as THREE from "three";
import { CSS3DObject, CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { toon, canvasTex } from "../palace/buildPalace";
import type { Box } from "../palace/arasaka";
import type { Now } from "./music";

// A big iron billboard on the lawn that plays the radio's song with YouTube's own player.
// The YouTube page sits in a layer BEHIND the 3D canvas, placed in 3D with CSS. The screen in the 3D
// scene is a see-through "hole", so anything in front of the billboard (walls, people, rain) still
// covers the video properly. The player is muted until you tap Listen; then it gets louder as you walk closer.

const SW = 16, SH = 9; // screen size in metres
const PX = 1280; // the YouTube page's width in CSS pixels
const K = 100; // the CSS scene is drawn 100x bigger: tiny CSS 3D scales flicker on some phones
const HEAR = 80; // metres: past this you hear nothing

type Info = { playerState?: number; currentTime?: number; duration?: number; muted?: boolean };

export class Billboard {
  root = new THREE.Group();
  solid: Box[] = [];
  center = new THREE.Vector3();
  onEnded: (id: string, skip: boolean) => void = () => {};
  onBlocked: () => void = () => {};
  private css: CSS3DRenderer;
  private cssScene = new THREE.Scene();
  private cssCam = new THREE.PerspectiveCamera();
  private obj: CSS3DObject;
  private frame: HTMLIFrameElement | null = null;
  private box: HTMLDivElement;
  private screen: THREE.Mesh;
  private idle: THREE.Material;
  private hole: THREE.Material;
  private song: Now = null;
  private info: Info = {};
  private ready = false;
  private loadedAt = 0;
  private hello = 0;
  private check = 0;
  private sentVol = -1;
  private done = false;
  listening = false;

  constructor(host: HTMLElement, at: THREE.Vector3, ry: number) {
    this.root.position.copy(at);
    this.root.rotation.y = ry;
    const iron = toon(0x1d1c22), red = toon(0x7e1c17), stone = toon(0x3a383f), brass = toon(0x8a6a3a);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.root.add(m);
      return m;
    };
    const cy = 7.6; // screen centre height
    // legs on stone plinths, a heavy back panel, red lacquer bezel, an iron cap with horns
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(2, 1.2, 2), stone, s * 6.5, 0.4, -0.7);
      add(new THREE.BoxGeometry(0.9, cy, 0.9), iron, s * 6.5, cy / 2, -0.7);
      add(new THREE.BoxGeometry(0.3, 6, 0.3), iron, s * 6.5, cy - 4, -1.6).rotation.x = -0.5; // brace
    }
    add(new THREE.BoxGeometry(SW + 1.6, SH + 1.6, 0.6), iron, 0, cy, -0.4);
    const bz = 0.08;
    add(new THREE.BoxGeometry(SW + 1.2, 0.6, 0.3), red, 0, cy + SH / 2 + 0.3, bz);
    add(new THREE.BoxGeometry(SW + 1.2, 0.6, 0.3), red, 0, cy - SH / 2 - 0.3, bz);
    add(new THREE.BoxGeometry(0.6, SH, 0.3), red, -SW / 2 - 0.3, cy, bz);
    add(new THREE.BoxGeometry(0.6, SH, 0.3), red, SW / 2 + 0.3, cy, bz);
    add(new THREE.BoxGeometry(SW + 2.6, 0.7, 2), iron, 0, cy + SH / 2 + 1, -0.3);
    for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.35, 1.8, 6), brass, s * (SW / 2 + 1.1), cy + SH / 2 + 2.1, -0.3).rotation.z = -s * 0.5;
    // a small brass sign under the screen
    add(new THREE.BoxGeometry(5, 0.9, 0.2), brass, 0, cy - SH / 2 - 1.1, 0);

    // the screen: a poster while nothing plays, a see-through hole while the video runs
    this.idle = new THREE.MeshBasicMaterial({
      map: canvasTex(512, 288, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, "#1a0d0b");
        gr.addColorStop(1, "#3a0f0c");
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "rgba(224,72,59,0.5)";
        g.lineWidth = 3;
        g.strokeRect(14, 14, w - 28, h - 28);
        g.textAlign = "center";
        g.fillStyle = "#f3e9d2";
        g.font = "bold 46px system-ui, sans-serif";
        g.fillText("ARASAKA RADIO", w / 2, h / 2 - 10);
        g.fillStyle = "#e0483b";
        g.font = "24px system-ui, sans-serif";
        g.fillText("Walk up and suggest a song", w / 2, h / 2 + 34);
      }),
      fog: false,
    });
    this.hole = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending, fog: false });
    this.screen = add(new THREE.PlaneGeometry(SW, SH), this.idle, 0, cy, 0.02);

    this.root.updateMatrixWorld(true);
    this.center.set(0, cy, 0).applyMatrix4(this.root.matrixWorld);
    // the legs block you; boxes are world-aligned so take each leg's footprint
    for (const s of [-1, 1]) {
      const p = new THREE.Vector3(s * 6.5, 0, -0.7).applyMatrix4(this.root.matrixWorld);
      this.solid.push({ x0: p.x - 1.1, x1: p.x + 1.1, z0: p.z - 1.1, z1: p.z + 1.1, y0: at.y - 1, y1: at.y + cy });
    }

    // the CSS layer for the YouTube page, behind the canvas
    this.css = new CSS3DRenderer();
    const el = this.css.domElement;
    el.className = "ex-css";
    host.prepend(el);
    this.box = document.createElement("div");
    this.box.style.cssText = `width:${PX}px;height:${(PX * SH) / SW}px;background:#000;pointer-events:none`;
    this.obj = new CSS3DObject(this.box);
    this.obj.position.copy(this.center).multiplyScalar(K);
    this.obj.rotation.y = ry;
    this.obj.scale.setScalar((SW * K) / PX);
    this.cssScene.add(this.obj);
    window.addEventListener("message", this.onMessage);
  }

  // which song plays now; secs = how far into it everyone is
  play(now: Now, secs: number) {
    if (now?.id === this.song?.id) return;
    this.song = now;
    this.frame?.remove();
    this.frame = null;
    this.ready = false;
    this.info = {};
    this.sentVol = -1;
    this.done = false;
    this.screen.material = now ? this.hole : this.idle;
    if (!now) return;
    const f = document.createElement("iframe");
    const q = new URLSearchParams({
      autoplay: "1", mute: "1", start: String(Math.floor(Math.max(0, secs))), controls: "0", disablekb: "1",
      enablejsapi: "1", playsinline: "1", rel: "0", iv_load_policy: "3", origin: location.origin,
    });
    f.src = `https://www.youtube-nocookie.com/embed/${now.id}?${q}`;
    f.allow = "autoplay; encrypted-media";
    f.title = now.title;
    f.style.cssText = "width:100%;height:100%;border:0;pointer-events:none";
    f.onload = () => { this.loadedAt = performance.now(); this.hello = 0; this.listen(); };
    this.box.appendChild(f);
    this.frame = f;
  }

  // call from a tap: browsers only allow sound after the player touched the screen
  setListening(on: boolean) {
    this.listening = on;
    this.sentVol = -1;
    if (on) { this.cmd("unMute"); this.cmd("playVideo"); }
    else this.cmd("mute");
  }

  // every frame
  tick(camera: THREE.PerspectiveCamera, w: number, h: number, you: THREE.Vector3, secs: number, dt: number) {
    // keep the CSS layer lined up with the 3D camera
    const c = this.cssCam;
    if (c.fov !== camera.fov || c.aspect !== camera.aspect) {
      c.fov = camera.fov;
      c.aspect = camera.aspect;
      c.updateProjectionMatrix();
    }
    c.position.copy(camera.position).multiplyScalar(K);
    c.quaternion.copy(camera.quaternion);
    if (this.css.getSize().width !== w || this.css.getSize().height !== h) this.css.setSize(w, h);
    this.obj.visible = !!this.song;
    this.css.render(this.cssScene, c);
    if (!this.song || !this.frame) return;

    // say hello until the player answers
    if (!this.ready && this.loadedAt && (this.hello -= dt) <= 0) { this.listen(); this.hello = 1; }

    // louder as you get closer
    const d = you.distanceTo(this.center);
    const vol = this.listening ? Math.round(100 * THREE.MathUtils.clamp(1 - (d - 14) / (HEAR - 14), 0, 1)) : 0;
    if (this.ready && Math.abs(vol - this.sentVol) >= 3) {
      if (vol === 0) this.cmd("mute");
      else { if (this.sentVol <= 0) this.cmd("unMute"); this.cmd("setVolume", [vol]); }
      this.sentVol = vol;
    }

    // stay on the same second as everyone else
    if ((this.check -= dt) > 0 || !this.ready) return;
    this.check = 2;
    const st = this.info.playerState, cur = this.info.currentTime ?? 0, dur = this.info.duration ?? 0;
    if (dur > 0 && secs > dur + 5) { this.end(false); return; }
    if (secs < 2) return;
    if (st === 1 && Math.abs(cur - secs) > 3) this.cmd("seekTo", [secs, true]);
    else if (st === 2 && this.listening) {
      // the phone paused it when sound came on without a tap: back to muted so the video keeps going
      this.listening = false;
      this.cmd("mute");
      this.cmd("playVideo");
      this.onBlocked();
    } else if ((st === -1 || st === 5 || st === 2) && performance.now() - this.loadedAt > 4000) {
      this.cmd("seekTo", [secs, true]);
      this.cmd("playVideo");
    }
  }

  dispose() {
    window.removeEventListener("message", this.onMessage);
    this.frame?.remove();
    this.css.domElement.remove();
  }

  private end(skip: boolean) {
    if (this.done || !this.song) return;
    this.done = true;
    this.onEnded(this.song.id, skip);
  }

  private listen() {
    this.frame?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
  }

  private cmd(func: string, args: unknown[] = []) {
    this.frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  }

  private onMessage = (e: MessageEvent) => {
    if (!this.frame || e.source !== this.frame.contentWindow || typeof e.data !== "string") return;
    let m: { event?: string; info?: Info | number };
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.event === "onReady" || m.event === "infoDelivery" || m.event === "initialDelivery") {
      this.ready = true;
      if (m.info && typeof m.info === "object") Object.assign(this.info, m.info);
      if (this.info.playerState === 0) this.end(false);
    } else if (m.event === "onStateChange" && typeof m.info === "number") {
      this.info.playerState = m.info;
      if (m.info === 0) this.end(false);
    } else if (m.event === "onError") this.end(true); // not allowed outside YouTube, removed, ...
  };
}
