import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildArena, buildPalace, skyTexture, softTexture, type ArenaKind, type PalaceStyle } from "./buildPalace";
import { ENVS } from "./weather";
import type { Weather } from "../clans";
import { PALACE } from "../config";
import { thunder } from "../sound";

type Props = { seed: string; weather?: Weather; style?: Partial<PalaceStyle>; className?: string; arena?: ArenaKind };

// A clan's palace in 3D, in that clan's weather. Drag to look around, pinch or scroll to zoom.
// When nobody touches it, the camera drifts slowly around the palace.
export default function Palace3D({ seed, weather = "day", style, className, arena }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const styleKey = JSON.stringify(style ?? {});

  useEffect(() => {
    const host = hostRef.current!;
    const env = ENVS[weather];
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, PALACE.MAX_PIXEL_RATIO));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = skyTexture(env.sky);
    scene.fog = new THREE.Fog(env.fog, env.fogNear, env.fogFar);

    const camera = new THREE.PerspectiveCamera(42, 1, 1, 1200);
    if (arena) camera.position.set(26, 30, 72);
    else camera.position.set(0, 58, 122);

    const hemi = new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemi);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(env.sun, env.sunI);
    sun.position.set(...env.sunPos);
    sun.castShadow = true;
    sun.shadow.mapSize.set(PALACE.SHADOW_SIZE, PALACE.SHADOW_SIZE);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -100;
    sc.right = sc.top = 100;
    sc.near = 10;
    sc.far = 400;
    scene.add(sun);

    // a battlefield (mode select) or a clan palace
    const { root, tick } = arena ? buildArena(arena, env) : buildPalace(seed, env, style);
    scene.add(root);

    // sky extras
    const glow = softTexture();
    if (env.stars) {
      const pts: number[] = [];
      for (let i = 0; i < 700; i++) {
        const a = Math.random() * Math.PI * 2, e = 0.15 + Math.random() * 1.3;
        pts.push(Math.cos(a) * Math.cos(e) * 520, Math.sin(e) * 520, Math.sin(a) * Math.cos(e) * 520);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false })));
    }
    const disk = (color: number, pos: [number, number, number], size: number) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, fog: false, depthWrite: false }));
      sp.position.set(...pos);
      sp.scale.setScalar(size);
      scene.add(sp);
    };
    if (env.moon) { disk(0xe9efff, [-160, 200, -420], 90); disk(0xffffff, [-160, 200, -420], 30); }
    if (env.sunDisk) disk(env.sunDisk, [-380, 70, -330], 160);

    // fireflies drifting over the courtyard
    let fireflies: THREE.Points | null = null;
    const ffBase: number[] = [];
    if (env.fireflies) {
      for (let i = 0; i < 90; i++) ffBase.push((Math.random() - 0.5) * 90, 1 + Math.random() * 6, (Math.random() - 0.5) * 100);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(ffBase.slice(), 3));
      fireflies = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8ff7a, size: 5, sizeAttenuation: false, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      scene.add(fireflies);
    }

    // rain: slanted streaks falling around the palace
    let rain: THREE.LineSegments | null = null;
    const RAIN = 2200;
    if (env.rain) {
      const pos = new Float32Array(RAIN * 6);
      for (let i = 0; i < RAIN; i++) {
        const x = (Math.random() - 0.5) * 200, y = Math.random() * 90, z = (Math.random() - 0.5) * 200;
        pos.set([x, y, z, x + 0.4, y + 2.2, z], i * 6);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xa9b8cc, transparent: true, opacity: 0.45 }));
      rain.frustumCulled = false;
      scene.add(rain);
    }

    // lightning: a jagged bolt plus a screen flash
    let bolt: THREE.Line | null = null;
    let nextFlash = 2 + Math.random() * 4, flashT = -1;
    if (env.lightning) {
      bolt = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xeef3ff, fog: false }));
      bolt.visible = false;
      scene.add(bolt);
    }
    const strike = () => {
      const a = Math.PI * (1.1 + Math.random() * 0.8), r = 200 + Math.random() * 150;
      let x = Math.cos(a) * r, z = Math.sin(a) * r, y = 260;
      const pts = [new THREE.Vector3(x, y, z)];
      while (y > 0) {
        y -= 15 + Math.random() * 20;
        x += (Math.random() - 0.5) * 30;
        z += (Math.random() - 0.5) * 10;
        pts.push(new THREE.Vector3(x, Math.max(0, y), z));
      }
      bolt!.geometry.dispose();
      bolt!.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      setTimeout(() => thunder(), 400 + Math.random() * 1200);
    };

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, arena ? 3 : 6, arena ? -2 : -2);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = arena ? 22 : PALACE.MIN_DISTANCE;
    controls.maxDistance = arena ? 90 : PALACE.MAX_DISTANCE;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = 1.38;
    controls.autoRotate = true;
    controls.autoRotateSpeed = PALACE.AUTO_ROTATE_SPEED;
    let idleTimer = 0;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
      clearTimeout(idleTimer);
    });
    controls.addEventListener("end", () => {
      idleTimer = window.setTimeout(() => (controls.autoRotate = true), PALACE.RESUME_ROTATE_MS);
    });

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 0.7 ? 55 : 42; // narrow phones need a wider view
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      if (document.hidden) return;
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.elapsedTime;
      tick(t, dt);

      if (rain) {
        const p = rain.geometry.attributes.position as THREE.BufferAttribute;
        const arr = p.array as Float32Array;
        for (let i = 0; i < RAIN; i++) {
          const o = i * 6;
          let y = arr[o + 1] - dt * 75;
          let x = arr[o] - dt * 12;
          if (y < 0) { y = 90; x = (Math.random() - 0.5) * 200; }
          arr[o] = x; arr[o + 1] = y; arr[o + 3] = x + 0.4; arr[o + 4] = y + 2.2;
        }
        p.needsUpdate = true;
      }
      if (fireflies) {
        const p = fireflies.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++)
          p.setXYZ(i, ffBase[i * 3] + Math.sin(t * 0.5 + i) * 2, ffBase[i * 3 + 1] + Math.sin(t * 1.3 + i * 2) * 0.8, ffBase[i * 3 + 2] + Math.cos(t * 0.4 + i) * 2);
        p.needsUpdate = true;
        (fireflies.material as THREE.PointsMaterial).opacity = 0.6 + Math.sin(t * 3) * 0.3;
      }
      if (env.lightning) {
        nextFlash -= dt;
        if (nextFlash <= 0) { strike(); flashT = 0; nextFlash = 4 + Math.random() * 7; }
        let f = 0;
        if (flashT >= 0) {
          flashT += dt;
          f = flashT < 0.08 ? 1 : flashT < 0.16 ? 0.25 : flashT < 0.26 ? 0.8 : Math.max(0, 1 - (flashT - 0.26) * 4);
          if (flashT > 0.6) flashT = -1;
        }
        hemi.intensity = env.hemi + f * 3;
        bolt!.visible = f > 0.5;
        if (flashRef.current) flashRef.current.style.opacity = String(f * 0.55);
      }

      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      clearTimeout(idleTimer);
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | undefined;
        if (mat && "map" in mat) (mat as THREE.MeshToonMaterial).map?.dispose();
        mat?.dispose?.();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, weather, styleKey, arena]);

  return (
    <div ref={hostRef} className={`palace3d ${className ?? ""}`}>
      <div ref={flashRef} className="lightning-flash" />
    </div>
  );
}
