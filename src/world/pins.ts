import * as THREE from "three";
import { supabase } from "../supabase";

// Dev pins: the developer marks a spot in the world with a note ("this stair floats"),
// so the fix list can be built from them. Saved in Supabase (world_pins, owner-only) and,
// as a backup, in this browser.

export type Pin = { id: string; created_at: string; x: number; y: number; z: number; yaw: number; pitch: number; note: string; done: boolean };

const KEY = "pb-world-pins";
const local = (): Pin[] => {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
};
const saveLocal = (p: Pin[]) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } };

export async function loadPins(): Promise<Pin[]> {
  if (supabase) {
    const { data, error } = await supabase.from("world_pins").select("*").eq("world", "arasaka").order("created_at");
    if (!error && data) {
      // pins dropped while the table didn't exist yet are kept and sent up
      const mine = local().filter((p) => p.id.startsWith("local-"));
      for (const p of mine) await addPin(p);
      if (mine.length) return loadPins();
      saveLocal(data as Pin[]);
      return data as Pin[];
    }
  }
  return local();
}

export async function addPin(p: Omit<Pin, "id" | "created_at" | "done"> & Partial<Pin>): Promise<Pin> {
  const row = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, note: p.note, world: "arasaka" };
  if (supabase) {
    const { data, error } = await supabase.from("world_pins").insert(row).select().single();
    if (!error && data) {
      saveLocal([...local().filter((q) => q.id !== p.id), data as Pin]);
      return data as Pin;
    }
  }
  const pin: Pin = { id: p.id ?? "local-" + Date.now(), created_at: p.created_at ?? new Date().toISOString(), done: false, ...row };
  saveLocal([...local().filter((q) => q.id !== pin.id), pin]);
  return pin;
}

export async function updatePin(id: string, patch: Partial<Pin>) {
  saveLocal(local().map((p) => (p.id === id ? { ...p, ...patch } : p)));
  if (supabase && !id.startsWith("local-")) await supabase.from("world_pins").update(patch).eq("id", id);
}

export async function deletePin(id: string) {
  saveLocal(local().filter((p) => p.id !== id));
  if (supabase && !id.startsWith("local-")) await supabase.from("world_pins").delete().eq("id", id);
}

// a plain text list to paste into chat
export const pinsText = (pins: Pin[]) =>
  pins.map((p, i) => `#${i + 1}${p.done ? " (fixed)" : ""} at x ${p.x.toFixed(1)}, y ${p.y.toFixed(1)}, z ${p.z.toFixed(1)}, look ${p.yaw.toFixed(2)}/${p.pitch.toFixed(2)}, ${p.created_at.slice(0, 16).replace("T", " ")}\n   ${p.note}`).join("\n");

// tall glowing markers with a number, seen from far away
export function pinMarkers() {
  const root = new THREE.Group();
  const tex = (n: number, done: boolean) => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = done ? "#2fbf71" : "#ff2d55";
    g.beginPath(); g.arc(64, 56, 48, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(30, 84); g.lineTo(98, 84); g.lineTo(64, 126); g.fill();
    g.fillStyle = "#fff";
    g.font = "bold 54px Inter, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(n), 64, 58);
    return new THREE.CanvasTexture(c);
  };
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.35, depthWrite: false });
  const doneMat = new THREE.MeshBasicMaterial({ color: 0x2fbf71, transparent: true, opacity: 0.3, depthWrite: false });
  const beamGeo = new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6);
  function set(pins: Pin[]) {
    for (const o of [...root.children]) {
      root.remove(o);
      o.traverse((m) => { const s = m as THREE.Sprite; if (s.isSprite) { s.material.map?.dispose(); s.material.dispose(); } });
    }
    pins.forEach((p, i) => {
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      const beam = new THREE.Mesh(beamGeo, p.done ? doneMat : beamMat);
      beam.position.y = 1.6;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(i + 1, p.done), depthTest: false, transparent: true }));
      sp.position.y = 3.9;
      sp.scale.set(1.4, 1.4, 1);
      sp.renderOrder = 10;
      g.add(beam, sp);
      root.add(g);
    });
  }
  return { root, set };
}
