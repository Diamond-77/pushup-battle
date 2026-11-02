import * as THREE from "three";
import { buildArena, skyTexture, type ArenaKind } from "./buildPalace";
import { ENVS } from "./weather";
import type { Weather } from "../clans";

// Still pictures of the battlefields for the mode-select cards. Rendered once per visit
// with a throwaway renderer, so only the selected battlefield is ever drawn live.
const cache = new Map<ArenaKind, string>();

export async function arenaShot(kind: ArenaKind, weather: Weather, w = 360, h = 480): Promise<string> {
  const hit = cache.get(kind);
  if (hit) return hit;
  const env = ENVS[weather];
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = skyTexture(env.sky);
  scene.fog = new THREE.Fog(env.fog, env.fogNear, env.fogFar);
  scene.add(new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemi));
  const sun = new THREE.DirectionalLight(env.sun, env.sunI);
  sun.position.set(...env.sunPos);
  scene.add(sun);
  const { root } = buildArena(kind, env);
  scene.add(root);
  const camera = new THREE.PerspectiveCamera(50, w / h, 1, 1200);
  camera.position.set(18, 17, 34);
  camera.lookAt(0, 2, -2);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/jpeg", 0.82);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | undefined;
    if (mat && "map" in mat) (mat as THREE.MeshToonMaterial).map?.dispose();
    mat?.dispose?.();
  });
  renderer.dispose();
  renderer.forceContextLoss();
  cache.set(kind, url);
  return url;
}
