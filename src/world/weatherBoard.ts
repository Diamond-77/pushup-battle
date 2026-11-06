import * as THREE from "three";
import { DAY_NAMES, nextRain, type SkyNow } from "./sky";
import type { Box } from "../palace/arasaka";

// A small weather screen on a post by the sand-yard arena: today, the time, rain or clear,
// and when the next rain comes (it rains Tue, Wed and Sat).
export function buildWeatherBoard(at: THREE.Vector3, ry: number) {
  const root = new THREE.Group();
  root.position.copy(at);
  root.rotation.y = ry;
  const W = 2.6, H = 1.6;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 316;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const dark = new THREE.MeshLambertMaterial({ color: 0x15161b });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.2, 0.22), dark);
  post.position.y = 1.1;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 0.24, H + 0.24, 0.16), dark);
  frame.position.y = 2.2 + H / 2;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(W + 0.34, H + 0.34, 0.08), new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
  edge.position.set(0, 2.2 + H / 2, -0.06);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.set(0, 2.2 + H / 2, 0.085);
  root.add(post, frame, edge, screen);

  let last = "";
  function update(s: SkyNow) {
    const hh = Math.floor(s.hour), mm = Math.floor((s.hour - hh) * 60);
    const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    const key = time + s.rain + s.wday;
    if (key === last) return;
    last = key;
    const g = canvas.getContext("2d")!, w = canvas.width, h = canvas.height;
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0b0f1c");
    bg.addColorStop(1, "#160b1e");
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // scanlines
    g.fillStyle = "rgba(255,255,255,0.04)";
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    g.fillStyle = "#ff2d55";
    g.fillRect(0, 0, w, 40);
    g.fillStyle = "#fff";
    g.font = "bold 26px Inter, sans-serif";
    g.textBaseline = "middle";
    g.fillText("ARASAKA WEATHER", 18, 21);
    g.textAlign = "right";
    g.fillText(time, w - 18, 21);
    g.textAlign = "left";
    // icon
    const night = s.night > 0.5;
    const cx = 105, cy = 150;
    if (s.rain) {
      g.fillStyle = "#9fb3c8";
      for (const [x, y, r] of [[cx - 30, cy, 34], [cx + 8, cy - 18, 42], [cx + 44, cy + 2, 30]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
      g.fillRect(cx - 30, cy, 74, 32);
      g.strokeStyle = "#2fd0ff";
      g.lineWidth = 6;
      g.lineCap = "round";
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(cx - 34 + i * 24, cy + 50); g.lineTo(cx - 44 + i * 24, cy + 78); g.stroke(); }
    } else if (night) {
      g.fillStyle = "#e8e2ff";
      g.beginPath(); g.arc(cx, cy, 52, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#0e0d1d";
      g.beginPath(); g.arc(cx + 24, cy - 16, 46, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = "#ffc94a";
      g.beginPath(); g.arc(cx, cy, 42, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#ffc94a";
      g.lineWidth = 7;
      for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; g.beginPath(); g.moveTo(cx + Math.cos(a) * 56, cy + Math.sin(a) * 56); g.lineTo(cx + Math.cos(a) * 74, cy + Math.sin(a) * 74); g.stroke(); }
    }
    g.fillStyle = "#fff";
    g.font = "bold 40px Inter, sans-serif";
    g.fillText(DAY_NAMES[s.wday], 205, 95);
    g.fillStyle = s.rain ? "#2fd0ff" : "#ffc94a";
    g.font = "bold 52px Inter, sans-serif";
    g.fillText(s.rain ? "RAIN" : night ? "CLEAR NIGHT" : "CLEAR", 205, 155);
    g.fillStyle = "#c9c2d8";
    g.font = "26px Inter, sans-serif";
    g.fillText(s.rain ? "Storm all day" : `Next rain: ${nextRain(s.wday)}`, 205, 210);
    g.fillStyle = "#8a83a0";
    g.font = "22px Inter, sans-serif";
    g.fillText("Rain days: Tue · Wed · Sat", 205, 262);
    tex.needsUpdate = true;
  }

  // the post blocks you
  const p = new THREE.Vector3(0, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry).add(at);
  const solid: Box[] = [{ x0: p.x - 0.25, x1: p.x + 0.25, z0: p.z - 0.25, z1: p.z + 0.25, y0: at.y, y1: at.y + 2.2 }];
  return { root, update, solid };
}
