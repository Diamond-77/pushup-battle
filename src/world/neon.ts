import * as THREE from "three";

// Red neon screens bolted onto the Arasaka walls: slogans that glitch now and then, scrolling tickers,
// and warning signs, for a dark cyberpunk edge on the old fortress.

type Kind = "sign" | "ticker" | "warn";
// lean: the wall's slope (stone walls lean back), so the sign sits flat on it
type Spec = { text: string; kind: Kind; x: number; y: number; z: number; ry: number; w: number; h: number; lean: number };

const T2 = 9, T3 = 20;
const WALL = Math.atan(1.2 / 10), TERRACE = Math.atan(0.8 / 9), TERRACE3 = Math.atan(0.8 / 11), KEEP = Math.atan(1 / 5);
// each sign sits a quarter metre in front of its wall face, measured at the sign's middle
const SIGNS: Spec[] = [
  // outside the front wall, seen as you walk up
  { text: "JOIN ARASAKA", kind: "sign", x: -48, y: 5.5, z: 83.1, ry: 0, w: 20, h: 3.2, lean: WALL },
  { text: "STRENGTH IS LAW", kind: "sign", x: 48, y: 5.5, z: 83.1, ry: 0, w: 20, h: 3.2, lean: WALL },
  // inside the front wall
  { text: "RESTRICTED ZONE", kind: "warn", x: -36, y: 6, z: 76.95, ry: Math.PI, w: 16, h: 2.6, lean: WALL },
  { text: "NO WEAKNESS PAST HERE", kind: "warn", x: 36, y: 6, z: 76.95, ry: Math.PI, w: 16, h: 2.2, lean: WALL },
  // the side walls of the lower court
  { text: "JOIN ARASAKA  //  100 PUSHUPS A DAY  //  RANK UP OR STEP ASIDE  //  THE STORM NEVER SLEEPS  //", kind: "ticker", x: -72.95, y: 6, z: 42, ry: Math.PI / 2, w: 26, h: 2.4, lean: WALL },
  { text: "CONSTRUCTION ZONE", kind: "warn", x: 72.95, y: 6, z: 42, ry: -Math.PI / 2, w: 22, h: 2.8, lean: WALL },
  // the terrace face, right of the grand stairs (the giant screen is on the left)
  { text: "ARASAKA RECRUITING  //  ARE YOU STRONG ENOUGH?  //  ENLIST AT THE GATE  //", kind: "ticker", x: 40, y: 4.6, z: 19.85, ry: 0, w: 28, h: 2.6, lean: TERRACE },
  // the upper terrace face, either side of its stairs
  { text: "ELITE ONLY", kind: "warn", x: -28, y: T2 + 5.5, z: -32.15, ry: 0, w: 14, h: 2.4, lean: TERRACE3 },
  { text: "SYSTEM ERROR", kind: "warn", x: 28, y: T2 + 5.5, z: -32.15, ry: 0, w: 14, h: 2.4, lean: TERRACE3 },
  // the keep's platform, either side of its steps
  { text: "THUNDER KEEP", kind: "sign", x: -13, y: T3 + 2.5, z: -47.25, ry: 0, w: 13, h: 2.2, lean: KEEP },
  { text: "AUTHORIZED ONLY", kind: "warn", x: 13, y: T3 + 2.5, z: -47.25, ry: 0, w: 13, h: 2.2, lean: KEEP },
];

const CW = 1024;

class Sign {
  mesh: THREE.Mesh;
  glow: THREE.Mesh;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private mat: THREE.MeshBasicMaterial;
  private ch: number;
  private nextGlitch = 1 + Math.random() * 4;
  private glitch = -1;
  private off = -1;
  private drawn = false;
  private s: Spec;

  constructor(s: Spec, glowTex: THREE.Texture) {
    this.s = s;
    this.ch = Math.round((CW * s.h) / s.w);
    const c = document.createElement("canvas");
    c.width = CW;
    c.height = this.ch;
    this.g = c.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), this.mat);
    this.mesh.position.set(s.x, s.y, s.z);
    this.mesh.rotation.set(-s.lean, s.ry, 0, "YXZ");
    // a soft red haze on the wall around it
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(s.w * 1.35, s.h * 2.6),
      new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff2030, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.glow.position.set(0, 0, -0.03);
    this.mesh.add(this.glow);
  }

  tick(t: number, dt: number, near: boolean) {
    // glitches and flickers come at random
    this.nextGlitch -= dt;
    if (this.nextGlitch <= 0) {
      this.glitch = 0.12 + Math.random() * 0.35;
      this.nextGlitch = (this.s.kind === "warn" ? 1.2 : 2.5) + Math.random() * 5;
      if (Math.random() < 0.35) this.off = 0.05 + Math.random() * 0.12;
    }
    const glitching = this.glitch > 0;
    if (glitching) this.glitch -= dt;
    if (this.off > 0) this.off -= dt;
    const k = this.off > 0 ? 0.18 : this.s.kind === "warn" ? 0.85 + 0.15 * Math.sin(t * 9) : 1;
    this.mat.color.setScalar(k);
    (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.45 * k;
    // redraw only what changes, and only close by
    if (!near && this.drawn) return;
    if (this.s.kind !== "ticker" && !glitching && this.drawn) return;
    this.draw(t, glitching);
  }

  private draw(t: number, glitching: boolean) {
    const g = this.g, W = CW, H = this.ch, s = this.s;
    this.drawn = true;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#0d0405";
    g.fillRect(0, 0, W, H);
    // scanlines
    g.fillStyle = "rgba(255,40,60,0.05)";
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    // warning signs get hazard stripes at both ends
    if (s.kind === "warn") {
      g.save();
      g.beginPath();
      g.rect(10, 10, H * 0.9, H - 20);
      g.rect(W - 10 - H * 0.9, 10, H * 0.9, H - 20);
      g.clip();
      g.fillStyle = "#ff2a3a";
      for (let x = -H; x < W + H; x += 36) {
        g.beginPath();
        g.moveTo(x, H);
        g.lineTo(x + 18, H);
        g.lineTo(x + 18 + H, 0);
        g.lineTo(x + H, 0);
        g.fill();
      }
      g.restore();
    }
    // the neon tube border
    g.shadowColor = "#ff1030";
    g.shadowBlur = 14;
    g.strokeStyle = "#ff4a5a";
    g.lineWidth = 5;
    g.strokeRect(8, 8, W - 16, H - 16);

    const size = Math.min(H * 0.56, 120);
    g.font = `900 ${size}px "Arial Black", Impact, system-ui, sans-serif`;
    g.textBaseline = "middle";
    const text = s.kind === "warn" ? `⚠ ${s.text} ⚠` : s.text;
    const tw = g.measureText(text).width;
    const pad = s.kind === "warn" ? H * 1.05 : 30;
    const room = W - pad * 2;
    let x: number;
    const sx = s.kind !== "ticker" && tw > room ? room / tw : 1; // squeeze long words to fit
    const period = tw + 120; // tickers loop with no empty gap
    if (s.kind === "ticker") x = -((t * 140) % period);
    else x = pad + (room - tw * sx) / 2;
    const line = (dx: number, color: string, blur: number) => {
      g.save();
      g.translate(x + dx, H / 2 + 2);
      g.scale(sx, 1);
      g.shadowColor = "#ff0022";
      g.shadowBlur = blur;
      g.fillStyle = color;
      g.fillText(text, 0, 0);
      if (s.kind === "ticker") for (let k = 1; x + k * period < W; k++) g.fillText(text, k * period, 0);
      g.restore();
    };
    if (s.kind !== "warn") {
      g.save();
      g.beginPath();
      g.rect(12, 12, W - 24, H - 24);
      g.clip();
    }
    line(0, "#ff3b4a", 26);
    line(0, "#ffd6da", 6);
    if (s.kind !== "warn") g.restore();

    if (glitching) {
      // tear the picture into bands that slip sideways, with a cyan ghost
      for (let i = 0; i < 5; i++) {
        const y = Math.random() * H, h = 4 + Math.random() * H * 0.25, dx = (Math.random() - 0.5) * 80;
        g.drawImage(g.canvas, 0, y, W, h, dx, y, W, h);
      }
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.5;
      g.shadowBlur = 0;
      g.fillStyle = "#18e0ff";
      g.save();
      g.translate(x + 6 + Math.random() * 6, H / 2 + 2);
      g.scale(sx, 1);
      g.fillText(text, 0, 0);
      g.restore();
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    this.tex.needsUpdate = true;
  }
}

export function buildNeon() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,0.9)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(c);
  const root = new THREE.Group();
  const signs = SIGNS.map((s) => new Sign(s, glowTex));
  signs.forEach((s) => root.add(s.mesh));
  let acc = 0;
  const v = new THREE.Vector3();
  return {
    root,
    // about 15 redraws a second, only for signs near you
    tick(t: number, dt: number, you: THREE.Vector3) {
      acc += dt;
      if (acc < 1 / 15) return;
      for (const s of signs) s.tick(t, acc, s.mesh.getWorldPosition(v).distanceTo(you) < 140);
      acc = 0;
    },
  };
}
