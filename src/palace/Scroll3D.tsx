import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// A hanging scroll in 3D, drawn like an anime prop: flat toon shading, ink outlines and sparkles.
// Closed it's rolled up and tied with a ribbon; tap it and it unrolls to show the lifetime push-ups.
type Props = { total: number; accent: string; name: string; open: boolean; onToggle: () => void; caption?: string };

const W = 3.6; // paper width (world units)
const H = 3.9; // paper height
const TOP = 2.1; // top rod height
const CLOSED = 0.06; // how much paper shows between the rods when rolled up
const VIEW_TOP = 2.65;
const R = 0.15; // rod radius

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

function toonRamp() {
  const t = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

function starTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.5)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#fff";
  g.beginPath(); // four-point anime twinkle
  g.moveTo(32, 0); g.quadraticCurveTo(35, 29, 64, 32); g.quadraticCurveTo(35, 35, 32, 64);
  g.quadraticCurveTo(29, 35, 0, 32); g.quadraticCurveTo(29, 29, 32, 0);
  g.fill();
  return new THREE.CanvasTexture(c);
}

function raysTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.translate(128, 128);
  for (let i = 0; i < 18; i++) {
    g.rotate((Math.PI * 2) / 18);
    const grd = g.createLinearGradient(0, 0, 128, 0);
    grd.addColorStop(0, "rgba(255,255,255,0.9)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(128, -9); g.lineTo(128, 9); g.closePath(); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

// The paper: parchment, ink border in the clan colour, the big number and a red seal.
function drawPaper(c: HTMLCanvasElement, n: number, accent: string, name: string, caption: string) {
  const g = c.getContext("2d")!;
  const w = c.width, h = c.height;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#f7ebcc");
  bg.addColorStop(1, "#ead39f");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // fibres
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = "rgba(120,80,30,0.07)";
  g.lineWidth = 1;
  for (let i = 0; i < 140; i++) {
    const x = rnd() * w, y = rnd() * h;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10 + rnd() * 30, y + (rnd() - 0.5) * 4); g.stroke();
  }
  const vig = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.75);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(90,50,10,0.28)");
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);
  // borders
  g.strokeStyle = accent;
  g.lineWidth = 7;
  g.strokeRect(22, 22, w - 44, h - 44);
  g.strokeStyle = "#2a1c12";
  g.lineWidth = 2;
  g.strokeRect(36, 36, w - 72, h - 72);
  for (const [x, y] of [[36, 36], [w - 36, 36], [36, h - 36], [w - 36, h - 36]]) {
    g.fillStyle = accent;
    g.beginPath(); g.moveTo(x, y - 12); g.lineTo(x + 12, y); g.lineTo(x, y + 12); g.lineTo(x - 12, y); g.closePath(); g.fill();
  }
  // title
  g.textAlign = "center";
  g.fillStyle = "#2a1c12";
  g.font = "800 30px Inter, system-ui, sans-serif";
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "6px";
  g.fillText("TOTAL PUSH-UPS", w / 2 + 3, 108);
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
  g.fillStyle = accent;
  g.beginPath(); g.moveTo(w / 2 - 110, 126); g.quadraticCurveTo(w / 2, 118, w / 2 + 110, 128); g.lineTo(w / 2 + 104, 134); g.quadraticCurveTo(w / 2, 126, w / 2 - 106, 132); g.fill();
  // the number, brush style with a colour offset like an anime title card
  const txt = n.toLocaleString();
  const size = txt.length > 6 ? 118 : txt.length > 4 ? 150 : 190;
  g.font = `${size}px "Ma Shan Zheng", "Brush Script MT", cursive`;
  g.fillStyle = accent;
  g.fillText(txt, w / 2 + 6, 330 + 6);
  g.fillStyle = "#16100b";
  g.fillText(txt, w / 2, 330);
  g.font = "600 22px Inter, system-ui, sans-serif";
  g.fillStyle = "rgba(42,28,18,0.75)";
  g.fillText(caption, w / 2, 400);
  // seal
  g.save();
  g.translate(w - 108, h - 112);
  g.rotate(-0.08);
  g.fillStyle = "#b8281f";
  g.fillRect(-36, -36, 72, 72);
  g.strokeStyle = "#f7ebcc";
  g.lineWidth = 3;
  g.strokeRect(-29, -29, 58, 58);
  g.fillStyle = "#f7ebcc";
  g.font = "44px \"Ma Shan Zheng\", serif";
  g.textBaseline = "middle";
  g.fillText((name.trim()[0] ?? "P").toUpperCase(), 0, 3);
  g.restore();
}

export default function Scroll3D({ total, accent, name, open, onToggle, caption = "done in Pushup Battle" }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const totalRef = useRef(total);
  totalRef.current = total;
  const [ppu, setPpu] = useState(72); // pixels per world unit, from the width

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-3, 3, VIEW_TOP, -2.5, 0.1, 50);
    camera.position.set(0, 0, 10);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-3, 5, 6);
    scene.add(key);

    const ramp = toonRamp();
    const accentCol = new THREE.Color(accent);
    const toon = (color: THREE.ColorRepresentation) => new THREE.MeshToonMaterial({ color, gradientMap: ramp });
    const inkMat = new THREE.MeshBasicMaterial({ color: 0x120c08, side: THREE.BackSide });
    const withOutline = (geo: THREE.BufferGeometry, mat: THREE.Material, grow = 1.08) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo, mat));
      const o = new THREE.Mesh(geo, inkMat);
      o.scale.setScalar(grow);
      g.add(o);
      return g;
    };
    const rod = () => {
      const g = new THREE.Group();
      const body = withOutline(new THREE.CylinderGeometry(R, R, W + 0.35, 20), toon(0x5b3320), 1.12);
      body.rotation.z = Math.PI / 2;
      g.add(body);
      // a pale highlight stripe along the top, like a cel-shaded gloss
      const gloss = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.2, 0.035), new THREE.MeshBasicMaterial({ color: 0xffe2b8, transparent: true, opacity: 0.8 }));
      gloss.position.set(0, R * 0.55, R + 0.01);
      g.add(gloss);
      for (const s of [-1, 1]) {
        const knob = withOutline(new THREE.CylinderGeometry(R * 1.55, R * 1.55, 0.22, 20), toon(accentCol), 1.1);
        knob.rotation.z = Math.PI / 2;
        knob.position.x = s * (W / 2 + 0.3);
        g.add(knob);
        const tip = withOutline(new THREE.SphereGeometry(R * 1.1, 16, 12), toon(accentCol.clone().lerp(new THREE.Color(0xffffff), 0.25)), 1.1);
        tip.position.x = s * (W / 2 + 0.5);
        g.add(tip);
      }
      return g;
    };

    const root = new THREE.Group();
    scene.add(root);

    // the cord it hangs from
    const cord = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-W / 2 + 0.2, TOP, 0), new THREE.Vector3(0, TOP + 0.5, 0), new THREE.Vector3(W / 2 - 0.2, TOP, 0)]),
      new THREE.LineBasicMaterial({ color: accentCol.clone().multiplyScalar(0.7) }),
    );
    root.add(cord);

    // burst of rays behind the paper when it opens
    const rays = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: raysTexture(), color: accentCol, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    rays.position.set(0, TOP - H / 2, -1);
    root.add(rays);

    // paper (a shader so it can unroll, shimmer and shade near the rod)
    const paperCanvas = document.createElement("canvas");
    paperCanvas.width = 512;
    paperCanvas.height = Math.round(512 * (H / W));
    const paperTex = new THREE.CanvasTexture(paperCanvas);
    paperTex.colorSpace = THREE.SRGBColorSpace;
    paperTex.anisotropy = 4;
    let shown = 0;
    const redraw = (n: number) => {
      drawPaper(paperCanvas, n, accent, name, caption);
      paperTex.needsUpdate = true;
    };
    redraw(0);
    document.fonts?.load('120px "Ma Shan Zheng"').then(() => redraw(shown)).catch(() => {});
    const paperMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: paperTex }, reveal: { value: CLOSED }, time: { value: 0 } },
      transparent: true,
      vertexShader: `
        varying vec2 vUv; uniform float time;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.z += sin(uv.y * 7.0 + time * 1.4) * 0.025 + sin(uv.x * 3.0 + time) * 0.015;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv; uniform sampler2D map; uniform float reveal; uniform float time;
        void main() {
          float edge = 1.0 - reveal;
          if (vUv.y < edge) discard;
          vec4 c = texture2D(map, vUv);
          // soft shadow where the paper meets the bottom rod
          c.rgb *= mix(0.62, 1.0, smoothstep(0.0, 0.06, vUv.y - edge));
          // a glossy sweep across the paper
          float b = vUv.x * 0.7 + vUv.y * 0.5;
          float s = fract(time * 0.22) * 2.4 - 0.6;
          c.rgb += smoothstep(0.07, 0.0, abs(b - s)) * 0.28;
          gl_FragColor = vec4(c.rgb, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(W, H, 1, 30), paperMat);
    paper.position.set(0, TOP - 0.1 - H / 2, 0);
    root.add(paper);
    // ink edge on the paper's sides
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x120c08 });
    const edges = [-1, 1].map((s) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 1), edgeMat);
      m.position.set(s * (W / 2 + 0.01), 0, -0.01);
      root.add(m);
      return m;
    });

    const topRod = rod();
    topRod.position.y = TOP;
    root.add(topRod);
    const bottomRod = rod();
    root.add(bottomRod);

    // ribbon tied round the rolled scroll
    const ribbon = new THREE.Group();
    const band = withOutline(new THREE.TorusGeometry(0.42, 0.06, 10, 32), toon(0xc8372d), 1.06);
    band.rotation.y = Math.PI / 2;
    band.scale.set(1, 0.9, 1.25);
    ribbon.add(band);
    for (const s of [-1, 1]) {
      const tail = withOutline(new THREE.BoxGeometry(0.14, 0.55, 0.03), toon(0xc8372d), 1.08);
      tail.position.set(s * 0.12, -0.52, 0.35);
      tail.rotation.z = s * 0.35;
      ribbon.add(tail);
    }
    ribbon.position.set(0, TOP - (CLOSED * H) / 2 - 0.1, 0);
    root.add(ribbon);

    // sparkles
    const starTex = starTexture();
    const sparks = Array.from({ length: 16 }, (_, i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, color: i % 3 ? 0xffffff : accentCol, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.userData = { x: (Math.random() - 0.5) * (W + 1.4), y: Math.random(), ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 1.4, s: 0.18 + Math.random() * 0.28 };
      root.add(sp);
      return sp;
    });

    let w = 0, h = 0;
    const resize = () => {
      w = host.clientWidth; h = host.clientHeight;
      if (!w || !h) return;
      const unit = Math.min(w / 5.2, 84);
      setPpu(unit);
      renderer.setSize(w, h, false);
      camera.left = -w / 2 / unit; camera.right = w / 2 / unit;
      camera.top = VIEW_TOP; camera.bottom = VIEW_TOP - h / unit;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let p = openRef.current ? 1 : 0; // unroll progress
    let counted = openRef.current ? 1 : 0; // number count-up progress
    let burst = 0;
    let wasOpen = openRef.current;
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      if (document.hidden) return;
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.elapsedTime;
      const target = openRef.current ? 1 : 0;
      if (openRef.current && !wasOpen) { burst = 1; counted = 0; }
      wasOpen = openRef.current;
      p += Math.sign(target - p) * Math.min(Math.abs(target - p), dt / (target ? 1.1 : 0.6));
      const e = target ? easeOut(p) : p * p;
      const reveal = CLOSED + (1 - CLOSED) * e;
      paperMat.uniforms.reveal.value = reveal;
      paperMat.uniforms.time.value = t;
      const bottomY = TOP - 0.1 - reveal * H - 0.02;
      bottomRod.position.y = bottomY;
      bottomRod.rotation.x = -(reveal * H) / R; // it rolls as it drops
      for (const m of edges) { m.scale.y = reveal * H; m.position.y = TOP - 0.1 - (reveal * H) / 2; }
      ribbon.scale.setScalar(Math.max(0.001, 1 - e * 3));
      ribbon.visible = e < 0.34;
      root.position.y = Math.sin(t * 1.2) * 0.04;
      root.rotation.z = Math.sin(t * 0.8) * 0.012;

      burst = Math.max(0, burst - dt * 0.7);
      const raysMat = rays.material as THREE.MeshBasicMaterial;
      raysMat.opacity = e * (0.12 + burst * 0.5);
      rays.rotation.z = t * 0.15;
      rays.scale.setScalar(0.7 + e * 0.3 + burst * 0.2);

      for (const sp of sparks) {
        const u = sp.userData as { x: number; y: number; ph: number; sp: number; s: number };
        const tw = Math.max(0, Math.sin(t * u.sp * 2 + u.ph));
        sp.position.set(u.x, TOP + 0.3 - u.y * (reveal * H + 0.6), 0.4);
        sp.scale.setScalar(u.s * (0.4 + tw) * (0.4 + e));
        (sp.material as THREE.SpriteMaterial).opacity = tw * (0.35 + 0.65 * e);
      }

      // count the number up while it opens
      if (openRef.current && counted < 1 && p > 0.35) counted = Math.min(1, counted + dt / 1.3);
      const want = Math.round(totalRef.current * easeOut(counted));
      if (want !== shown && (openRef.current || counted >= 1)) { shown = want; redraw(shown); }

      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | undefined;
        mat?.dispose?.();
      });
      paperTex.dispose(); starTex.dispose(); ramp.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [accent, name, caption]);

  // closed: just the rolled scroll; open: room for the whole paper
  const height = open ? Math.round((VIEW_TOP - (TOP - 0.1 - H - 0.35)) * ppu) : Math.round((VIEW_TOP - (TOP - 0.1 - CLOSED * H - 0.95)) * ppu);
  return (
    <div ref={hostRef} className={`scroll3d ${open ? "open" : ""}`} style={{ height }} onClick={onToggle} role="button" aria-label={open ? "Roll up the scroll" : "Open the scroll"}>
      {!open && <div className="scroll-hint">Tap to open</div>}
    </div>
  );
}
