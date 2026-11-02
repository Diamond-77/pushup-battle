import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildPalace, skyTexture } from "./buildPalace";
import { PALACE } from "../config";

// A clan's palace in 3D. Drag to look around, pinch or scroll to zoom.
// When nobody touches it, the camera drifts slowly around the palace.
export default function Palace3D({ clan, className }: { clan: string; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, PALACE.MAX_PIXEL_RATIO));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = skyTexture();
    scene.fog = new THREE.Fog(0xe4ecf0, 180, 650);

    const camera = new THREE.PerspectiveCamera(42, 1, 1, 1200);
    camera.position.set(0, 52, 112);

    scene.add(new THREE.HemisphereLight(0xdfefff, 0x6f8f4a, 1.4));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(-60, 110, 70);
    sun.castShadow = true;
    sun.shadow.mapSize.set(PALACE.SHADOW_SIZE, PALACE.SHADOW_SIZE);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -80;
    sc.right = sc.top = 80;
    sc.near = 10;
    sc.far = 300;
    scene.add(sun);

    const { root, mist } = buildPalace(clan);
    scene.add(root);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 6, -2);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = PALACE.MIN_DISTANCE;
    controls.maxDistance = PALACE.MAX_DISTANCE;
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
      // narrow phone screens need a wider view to fit the palace
      camera.fov = w / h < 0.7 ? 55 : 42;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      if (document.hidden) return;
      const t = clock.getElapsedTime();
      mist.children.forEach((m, i) => (m.position.x += Math.sin(t * 0.1 + i) * 0.02));
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
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [clan]);

  return <div ref={hostRef} className={`palace3d ${className ?? ""}`} />;
}
