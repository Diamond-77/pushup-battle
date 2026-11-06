import * as THREE from "three";

// A wall of hellfire burning behind Arasaka, like the citadel is the lair of demon samurai.
// A few layered flame curtains (an animated noise shader, added light so they glow), a red haze low
// on the horizon, and embers drifting up into the storm.

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const frag = /* glsl */ `
uniform float uTime, uSeed, uPower;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec2 uv = vUv;
  // flames rush upward and sway
  vec2 p = vec2(uv.x * 9.0 + uSeed, uv.y * 3.0 - uTime * 1.1);
  p.x += 0.35 * sin(uv.y * 4.0 + uTime * 0.7 + uSeed);
  float n = fbm(p) * 0.7 + fbm(p * 2.3 + vec2(0.0, -uTime * 0.8)) * 0.4;
  // tall tongues of fire along the width, fading toward the top
  float tongues = 0.55 + 0.45 * fbm(vec2(uv.x * 6.0 + uSeed, uTime * 0.15));
  float h = pow(1.0 - uv.y, 1.3) * tongues * 1.6;
  float f = smoothstep(0.0, 0.9, n * h * 1.8 - uv.y * 0.35);
  // soft edges left and right
  f *= smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.92, uv.x);
  vec3 col = mix(vec3(0.35, 0.02, 0.01), vec3(1.0, 0.25, 0.05), smoothstep(0.1, 0.5, f));
  col = mix(col, vec3(1.0, 0.55, 0.2), smoothstep(0.65, 1.0, f));
  gl_FragColor = vec4(col * f * uPower, 1.0);
}`;

export function buildAura() {
  const root = new THREE.Group();
  const mats: THREE.ShaderMaterial[] = [];
  // curtains: [z, width, height, y bottom, power]
  const layers: [number, number, number, number, number][] = [
    [-155, 320, 190, -4, 0.85],
    [-143, 260, 150, -2, 0.95],
    [-134, 200, 95, 0, 1.0],
  ];
  layers.forEach(([z, w, h, y, power], i) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uTime: { value: 0 }, uSeed: { value: i * 7.3 }, uPower: { value: power } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    mats.push(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(0, y + h / 2, z);
    mesh.renderOrder = -1;
    root.add(mesh);
    // the curtain bends round the back corners a little, so it doesn't look like a flat card from the side
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.35, h * 0.8), mat);
      wing.position.set(side * (w / 2 + w * 0.12), y + h * 0.4, z + w * 0.14);
      wing.rotation.y = -side * 0.9;
      wing.renderOrder = -1;
      root.add(wing);
    }
  });

  // a red haze low behind the citadel, the light of the fire on the storm clouds
  const hazeTex = (() => {
    const c = document.createElement("canvas");
    c.width = 4; c.height = 128;
    const g = c.getContext("2d")!, grad = g.createLinearGradient(0, 128, 0, 0);
    grad.addColorStop(0, "rgba(255,70,20,0.75)");
    grad.addColorStop(0.4, "rgba(170,20,10,0.35)");
    grad.addColorStop(1, "rgba(60,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 128);
    return new THREE.CanvasTexture(c);
  })();
  const hazeMat = new THREE.MeshBasicMaterial({ map: hazeTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(420, 170), hazeMat);
  haze.position.set(0, 90, -180);
  haze.renderOrder = -2;
  root.add(haze);

  // embers rising from the fire, drifting over the keep
  const N = 500;
  const pos = new Float32Array(N * 3), speed = new Float32Array(N);
  const reset = (k: number, anyHeight: boolean) => {
    pos[k * 3] = (Math.random() - 0.5) * 240;
    pos[k * 3 + 1] = anyHeight ? Math.random() * 120 : Math.random() * 10;
    pos[k * 3 + 2] = -128 - Math.random() * 25;
    speed[k] = 4 + Math.random() * 8;
  };
  for (let k = 0; k < N; k++) reset(k, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const dot = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!, grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,220,150,1)");
    grad.addColorStop(0.35, "rgba(255,110,30,0.8)");
    grad.addColorStop(1, "rgba(255,40,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const emberMat = new THREE.PointsMaterial({ map: dot, size: 1.4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const embers = new THREE.Points(geo, emberMat);
  embers.frustumCulled = false;
  root.add(embers);

  // fire light spilling onto the back of the citadel
  const light = new THREE.PointLight(0xff4a1a, 2.5, 160, 1.2);
  light.position.set(0, 25, -125);
  root.add(light);

  // strength: 1 at night, fading to 0 by day (the hellfire only burns after dark)
  function tick(t: number, dt: number, strength = 1) {
    // the light stays (intensity 0) so the number of lights never changes, which would recompile shaders
    const on = strength > 0.02;
    for (const o of root.children) if (o !== light) o.visible = on;
    light.intensity = 0;
    if (!on) return;
    mats.forEach((m, i) => { m.uniforms.uTime.value = t; m.uniforms.uPower.value = layers[i][4] * strength; });
    hazeMat.opacity = strength;
    emberMat.opacity = strength;
    for (let k = 0; k < N; k++) {
      pos[k * 3 + 1] += speed[k] * dt;
      pos[k * 3] += Math.sin(t * 0.8 + k) * dt * 1.5;
      pos[k * 3 + 2] += dt * 2.5; // the wind carries them over the citadel
      if (pos[k * 3 + 1] > 130) reset(k, false);
    }
    geo.attributes.position.needsUpdate = true;
    light.intensity = (2.2 + Math.sin(t * 7) * 0.3 + Math.sin(t * 13.1) * 0.2) * strength;
  }

  return { root, tick };
}
