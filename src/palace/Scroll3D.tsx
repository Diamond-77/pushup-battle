import { useEffect, useRef } from "react";
import * as THREE from "three";

// A hand scroll in 3D, drawn in the same anime style as the clan shrines: cel shading on the same
// three-step ramp, ink outlines and painted canvas textures. Closed, it's a rolled brocade scroll
// tied with a cord; tap it and it unrolls sideways to show the lifetime push-ups.
type Props = { total: number; accent: string; dark: string; mid: string; name: string; open: boolean; onToggle: () => void; caption?: string };

const W = 4.6; // paper width (world units)
const H = 2.7; // paper height
const X0 = -W / 2; // the fixed rod on the left
const ROD = 0.09;
const R_CLOSED = 0.34; // rolled-up radius
const R_OPEN = 0.15;
const INK = 0x1a120c;

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

let ramp: THREE.DataTexture | null = null;
function toonRamp() {
  if (ramp) return ramp;
  ramp = new THREE.DataTexture(new Uint8Array([95, 95, 95, 255, 180, 180, 180, 255, 255, 255, 255, 255]), 3, 1);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// brocade on the back of the scroll: gold clouds and waves on the clan's dark colour
function brocade(dark: string, accent: string) {
  const t = canvasTex(512, 256, (g) => {
    g.fillStyle = dark;
    g.fillRect(0, 0, 512, 256);
    g.strokeStyle = accent;
    g.globalAlpha = 0.35;
    g.lineWidth = 2;
    for (let y = 0; y < 256; y += 16) {
      g.beginPath();
      for (let x = 0; x <= 512; x += 8) g.lineTo(x, y + Math.sin(x / 20 + y) * 3);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.strokeStyle = "#d4ae62";
    g.lineWidth = 3;
    g.lineCap = "round";
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 6; col++) {
        const x = col * 90 + (row % 2) * 45, y = row * 70 + 30;
        g.beginPath(); g.arc(x, y, 14, Math.PI * 0.2, Math.PI * 1.9); g.stroke();
        g.beginPath(); g.arc(x + 4, y + 2, 7, Math.PI * 1.2, Math.PI * 2.6); g.stroke();
        g.beginPath(); g.arc(x + 24, y + 8, 10, Math.PI, Math.PI * 2.2); g.stroke();
        g.beginPath(); g.moveTo(x - 18, y + 14); g.quadraticCurveTo(x + 10, y + 26, x + 38, y + 14); g.stroke();
      }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function starTexture() {
  return canvasTex(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.25, "rgba(255,255,255,0.45)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#fff";
    g.beginPath();
    g.moveTo(32, 0); g.quadraticCurveTo(35, 29, 64, 32); g.quadraticCurveTo(35, 35, 32, 64);
    g.quadraticCurveTo(29, 35, 0, 32); g.quadraticCurveTo(29, 29, 32, 0);
    g.fill();
  });
}

// the paper: parchment, the clan colour as a border, a painted blossom, the number and a red seal
function drawPaper(c: HTMLCanvasElement, n: number, accent: string, name: string, caption: string) {
  const g = c.getContext("2d")!;
  const w = c.width, h = c.height;
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#f8edd0");
  bg.addColorStop(1, "#ead39f");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = "rgba(120,80,30,0.07)";
  for (let i = 0; i < 200; i++) {
    const x = rnd() * w, y = rnd() * h;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10 + rnd() * 34, y + (rnd() - 0.5) * 4); g.stroke();
  }
  // painted blossom branch, top left
  g.save();
  g.globalAlpha = 0.5;
  g.strokeStyle = "#3a2618";
  g.lineWidth = 6;
  g.lineCap = "round";
  g.beginPath(); g.moveTo(40, 40); g.quadraticCurveTo(140, 70, 190, 170); g.stroke();
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(110, 62); g.quadraticCurveTo(150, 40, 200, 50); g.stroke();
  g.fillStyle = accent;
  for (const [x, y, r] of [[120, 64, 13], [176, 128, 11], [196, 48, 10], [70, 46, 9], [190, 172, 8]]) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, r * 0.6, r * 0.45, a, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
  // borders
  g.strokeStyle = accent;
  g.lineWidth = 8;
  g.strokeRect(20, 20, w - 40, h - 40);
  g.strokeStyle = "#2a1c12";
  g.lineWidth = 2;
  g.strokeRect(36, 36, w - 72, h - 72);
  // title, the number with a colour offset like an anime title card, caption
  g.textAlign = "center";
  g.fillStyle = "#2a1c12";
  g.font = "800 34px Inter, system-ui, sans-serif";
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "8px";
  g.fillText("TOTAL PUSH-UPS", w / 2 + 4, 120);
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
  g.fillStyle = accent;
  g.fillRect(w / 2 - 120, 138, 240, 5);
  const txt = n.toLocaleString();
  const size = txt.length > 6 ? 170 : txt.length > 4 ? 200 : 240;
  g.font = `${size}px "Ma Shan Zheng", "Brush Script MT", cursive`;
  g.fillStyle = accent;
  g.fillText(txt, w / 2 + 7, 375 + 7);
  g.fillStyle = "#16100b";
  g.fillText(txt, w / 2, 375);
  g.font = "600 26px Inter, system-ui, sans-serif";
  g.fillStyle = "rgba(42,28,18,0.75)";
  g.fillText(caption, w / 2, 450);
  g.save();
  g.translate(w - 120, h - 118);
  g.rotate(-0.08);
  g.fillStyle = "#b8281f";
  g.fillRect(-40, -40, 80, 80);
  g.strokeStyle = "#f7ebcc";
  g.lineWidth = 3;
  g.strokeRect(-32, -32, 64, 64);
  g.fillStyle = "#f7ebcc";
  g.font = '50px "Ma Shan Zheng", serif';
  g.textBaseline = "middle";
  g.fillText((name.trim()[0] ?? "P").toUpperCase(), 0, 4);
  g.restore();
}

export default function Scroll3D({ total, accent, dark, mid, name, open, onToggle, caption = "done in Pushup Battle" }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const totalRef = useRef(total);
  totalRef.current = total;

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1.6, 0.1, 60);

    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a2c40, 1.3));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-4, 5, 6);
    scene.add(sun);

    const rampTex = toonRamp();
    const toon = (color: THREE.ColorRepresentation, map?: THREE.Texture) => new THREE.MeshToonMaterial({ color: map ? 0xffffff : color, gradientMap: rampTex, ...(map ? { map } : {}) });
    const inkHull = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    const lineMat = new THREE.LineBasicMaterial({ color: 0x2a1c12, transparent: true, opacity: 0.6 });
    const accentCol = new THREE.Color(accent);
    const gold = toon(0xd4ae62);
    const lacquer = toon(0x15110f);
    // a cylinder standing up, with an ink hull for the silhouette and ink edges on the caps (like the shrines)
    const cyl = (r: number, h: number, mat: THREE.Material, outline = 0.035) => {
      const g = new THREE.Group();
      const geo = new THREE.CylinderGeometry(r, r, h, 28);
      g.add(new THREE.Mesh(geo, mat));
      const hull = new THREE.Mesh(geo, inkHull);
      hull.scale.set(1 + outline / r, 1 + outline / h, 1 + outline / r);
      g.add(hull);
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), lineMat));
      return g;
    };
    // a rod with lacquered end caps and gold rings
    const rod = () => {
      const g = new THREE.Group();
      g.add(cyl(ROD, H + 0.5, toon(0x4a2a1c)));
      for (const s of [-1, 1]) {
        const cap = cyl(0.15, 0.2, lacquer);
        cap.position.y = s * (H / 2 + 0.3);
        g.add(cap);
        const ring = cyl(0.165, 0.05, gold, 0.02);
        ring.position.y = s * (H / 2 + 0.19);
        g.add(ring);
      }
      return g;
    };

    const root = new THREE.Group();
    root.rotation.y = -0.14;
    scene.add(root);

    const rays = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({
        map: canvasTex(256, 256, (g) => {
          g.translate(128, 128);
          for (let i = 0; i < 18; i++) {
            g.rotate((Math.PI * 2) / 18);
            const grd = g.createLinearGradient(0, 0, 128, 0);
            grd.addColorStop(0, "rgba(255,255,255,0.9)");
            grd.addColorStop(1, "rgba(255,255,255,0)");
            g.fillStyle = grd;
            g.beginPath(); g.moveTo(0, 0); g.lineTo(128, -9); g.lineTo(128, 9); g.closePath(); g.fill();
          }
        }),
        color: accentCol, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    rays.position.set(0, 0, -1.2);
    root.add(rays);

    // paper: unrolls from the left rod; a shader hides what's still rolled up, shades the edge and adds a gloss sweep
    const paperCanvas = document.createElement("canvas");
    paperCanvas.width = 1024;
    paperCanvas.height = Math.round(1024 * (H / W));
    const paperTex = new THREE.CanvasTexture(paperCanvas);
    paperTex.colorSpace = THREE.SRGBColorSpace;
    paperTex.anisotropy = 4;
    let shown = 0;
    const redraw = (n: number) => { drawPaper(paperCanvas, n, accent, name, caption); paperTex.needsUpdate = true; };
    redraw(0);
    document.fonts?.load('120px "Ma Shan Zheng"').then(() => redraw(shown)).catch(() => {});
    const paperMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: paperTex }, reveal: { value: 0 }, time: { value: 0 } },
      vertexShader: `
        varying vec2 vUv; uniform float time;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.z += sin(uv.x * 6.0 + time * 1.3) * 0.03;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv; uniform sampler2D map; uniform float reveal; uniform float time;
        void main() {
          if (vUv.x > reveal) discard;
          vec4 c = texture2D(map, vUv);
          // cel-style shade bands: a hard step near the roll, like the shrines' toon ramp
          float d = reveal - vUv.x;
          c.rgb *= d < 0.012 ? 0.6 : d < 0.035 ? 0.8 : 1.0;
          c.rgb *= vUv.x < 0.012 ? 0.7 : 1.0;
          float b = vUv.x * 0.6 + vUv.y * 0.4;
          float s = fract(time * 0.2) * 2.4 - 0.6;
          c.rgb += smoothstep(0.05, 0.0, abs(b - s)) * 0.3;
          gl_FragColor = vec4(c.rgb, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(W, H, 40, 1), paperMat);
    paper.position.x = X0 + W / 2;
    root.add(paper);
    // ink lines along the paper's top and bottom edges
    const edgeTop = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.03), new THREE.MeshBasicMaterial({ color: INK }));
    const edgeBot = edgeTop.clone();
    root.add(edgeTop, edgeBot);

    const leftRod = rod();
    leftRod.position.x = X0;
    root.add(leftRod);

    // the rolled part: brocade on the outside, a rod through the middle; it rolls as it travels
    const roll = new THREE.Group();
    const rollTex = brocade(dark, mid);
    const rollMat = toon(0xffffff, rollTex);
    const rollBody = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, H, 36), rollMat);
    const rollHull = new THREE.Mesh(rollBody.geometry, inkHull);
    roll.add(rollBody, rollHull, rod());
    root.add(roll);

    // cord tied round it while closed, with a tassel
    const cord = new THREE.Group();
    const cordMat = toon(accentCol);
    for (const y of [0.32, -0.32]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 40), cordMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      cord.add(band);
    }
    const tassel = new THREE.Group();
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), cordMat);
    const knotHull = new THREE.Mesh(knot.geometry, inkHull);
    knotHull.scale.setScalar(1.3);
    tassel.add(knot, knotHull);
    const fringe = cyl(0.06, 0.5, cordMat, 0.02);
    fringe.position.y = -0.3;
    tassel.add(fringe);
    cord.add(tassel);
    root.add(cord);

    const starTex = starTexture();
    const sparks = Array.from({ length: 14 }, (_, i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, color: i % 3 ? 0xffffff : accentCol, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.userData = { u: Math.random(), y: (Math.random() - 0.5) * (H + 0.6), ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 1.4, s: 0.16 + Math.random() * 0.26 };
      root.add(sp);
      return sp;
    });

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const z = Math.max((W + 1.3) / (2 * tan * camera.aspect), (H + 1.6) / (2 * tan));
      camera.position.set(0.5, 0.15, z);
      camera.lookAt(0, -0.3, 0);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let p = openRef.current ? 1 : 0;
    let counted = p;
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
      p += Math.sign(target - p) * Math.min(Math.abs(target - p), dt / (target ? 1.2 : 0.7));
      const e = target ? easeOut(p) : p * p;

      const r = R_CLOSED + (R_OPEN - R_CLOSED) * e;
      const rollX = X0 + ROD + r + (W - ROD - r) * e;
      const reveal = Math.max(0, (rollX - X0) / W);
      paperMat.uniforms.reveal.value = e < 0.01 ? 0 : reveal;
      paperMat.uniforms.time.value = t;
      roll.position.x = rollX;
      rollBody.scale.set(r, 1, r);
      rollHull.scale.set(r + 0.035, 1.01, r + 0.035);
      roll.rotation.y = -((rollX - X0) / r) * 0.5; // it turns as it travels
      rollTex.offset.x = -roll.rotation.y / (Math.PI * 2);
      for (const [m, y] of [[edgeTop, H / 2], [edgeBot, -H / 2]] as const) {
        const len = Math.max(0.001, rollX - X0);
        m.scale.x = len; m.position.set(X0 + len / 2, y, 0.005);
        m.visible = e > 0.01;
      }
      cord.position.x = rollX;
      cord.children.slice(0, 2).forEach((b) => b.scale.set(r + 0.03, r + 0.03, 1));
      tassel.position.set(0, -0.32, r + 0.06);
      cord.visible = e < 0.12;
      root.position.y = Math.sin(t * 1.2) * 0.04;

      burst = Math.max(0, burst - dt * 0.7);
      const rm = rays.material as THREE.MeshBasicMaterial;
      rm.opacity = e * (0.1 + burst * 0.45);
      rays.rotation.z = t * 0.15;
      rays.scale.setScalar(0.7 + e * 0.3 + burst * 0.2);

      for (const sp of sparks) {
        const u = sp.userData as { u: number; y: number; ph: number; sp: number; s: number };
        const tw = Math.max(0, Math.sin(t * u.sp * 2 + u.ph));
        sp.position.set(X0 + u.u * (rollX - X0 + 0.4), u.y, 0.4);
        sp.scale.setScalar(u.s * (0.4 + tw) * (0.3 + e));
        (sp.material as THREE.SpriteMaterial).opacity = tw * (0.25 + 0.75 * e);
      }

      if (openRef.current && counted < 1 && p > 0.3) counted = Math.min(1, counted + dt / 1.3);
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
      paperTex.dispose(); rollTex.dispose(); starTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [accent, dark, mid, name, caption]);

  return (
    <div ref={hostRef} className={`scroll3d ${open ? "open" : ""}`} onClick={onToggle} role="button" aria-label={open ? "Roll up the scroll" : "Open the scroll"} />
  );
}
