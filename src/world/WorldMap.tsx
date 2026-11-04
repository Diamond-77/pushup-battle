import { Suspense, lazy, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { buildWorld, CROSSROADS, type Site } from "./buildWorld";
import { CLANS, clanById } from "../clans";
import ClanLogo from "../ClanLogo";
import "./world.css";

const Palace3D = lazy(() => import("../palace/Palace3D"));

const WEATHER_WORD = { storm: "Eternal storm", sunset: "Endless sunset", night: "Moonlit night", day: "Clear day" } as const;

// The open-world map: where the three clan empires lie. Drag to move, pinch to zoom, twist to turn.
// Tap an empire to fly to it, then visit its palace.
export default function WorldMap({ onBack }: { onBack?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const crossRef = useRef<HTMLDivElement>(null);
  const flyRef = useRef<(id: string | null) => void>(() => {});
  const pausedRef = useRef(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [visiting, setVisiting] = useState<string | null>(null);
  const [hint, setHint] = useState(true);

  useEffect(() => {
    pausedRef.current = !!visiting;
  }, [visiting]);

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x7a7f96, 700, 2000);
    const world = buildWorld(scene);
    setSites(world.sites);

    const camera = new THREE.PerspectiveCamera(50, 1, 2, 5000);
    const controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.minDistance = 70;
    controls.maxDistance = 1100;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.2;
    controls.zoomToCursor = true;

    // the overview shot; the camera starts high up and glides down into it
    const overview = () => {
      const narrow = camera.aspect < 0.8;
      return {
        target: new THREE.Vector3(0, 0, narrow ? -40 : -40),
        pos: new THREE.Vector3(0, narrow ? 640 : 420, narrow ? 420 : 380),
      };
    };
    let fly: { t: number; dur: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3 } | null = null;
    const flyTo = (target: THREE.Vector3, pos: THREE.Vector3, dur = 1.4) => {
      fly = { t: 0, dur, fromT: controls.target.clone(), toT: target, fromP: camera.position.clone(), toP: pos };
    };
    flyRef.current = (id) => {
      const s = world.sites.find((x) => x.clan.id === id);
      if (!s) {
        const o = overview();
        flyTo(o.target, o.pos);
        return;
      }
      // look at the palace from the crossroads side, a bit above
      const dir = new THREE.Vector3(CROSSROADS.x - s.pos.x, 0, CROSSROADS.z - s.pos.z).normalize();
      const narrow = camera.aspect < 0.8;
      // aim a little in front of the palace so it sits above the info card
      const aim = s.pos.clone().addScaledVector(dir, narrow ? 45 : 20).setY(4);
      flyTo(aim, aim.clone().addScaledVector(dir, narrow ? 140 : 120).setY(narrow ? 125 : 95));
    };

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 0.8 ? 58 : 46;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const o = overview();
    controls.target.copy(o.target);
    camera.position.copy(o.pos).add(new THREE.Vector3(0, 500, 200));
    controls.update();
    flyTo(o.target, o.pos, 2.6);

    // keep the view over the island
    controls.addEventListener("change", () => {
      const t = controls.target;
      const r = Math.hypot(t.x, t.z);
      if (r > 360) {
        const k = 360 / r;
        const dx = t.x * k - t.x, dz = t.z * k - t.z;
        t.x += dx; t.z += dz;
        camera.position.x += dx; camera.position.z += dz;
      }
      t.y = 0;
    });
    controls.addEventListener("start", () => { fly = null; setHint(false); });

    // tap (not drag) on a palace selects it; tap on empty land clears the selection
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down: { x: number; y: number; t: number } | null = null;
    const el = renderer.domElement;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 400;
      down = null;
      if (moved > 8 || !quick) return;
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(world.hits, false)[0];
      const id = (hit?.object.userData.clan as string | undefined) ?? null;
      setSelected(id);
      if (id) flyRef.current(id);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);

    // labels follow their palaces on screen
    const v = new THREE.Vector3();
    const place = (node: HTMLElement | null, p: THREE.Vector3, lift: number) => {
      if (!node) return;
      v.copy(p).setY(p.y + lift).project(camera);
      const behind = v.z > 1;
      const x = (v.x * 0.5 + 0.5) * host.clientWidth, y = (-v.y * 0.5 + 0.5) * host.clientHeight;
      const k = THREE.MathUtils.clamp(520 / camera.position.distanceTo(p), 0.75, 1.15);
      node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${k.toFixed(3)})`;
      node.style.opacity = behind ? "0" : "1";
    };

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(0.05, clock.getDelta());
      if (document.hidden || pausedRef.current) return;
      const t = clock.elapsedTime;
      world.tick(t, dt);
      if (fly) {
        fly.t += dt / fly.dur;
        const k = fly.t >= 1 ? 1 : fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
        controls.target.lerpVectors(fly.fromT, fly.toT, k);
        camera.position.lerpVectors(fly.fromP, fly.toP, k);
        if (fly.t >= 1) fly = null;
      }
      controls.update();
      for (const s of world.sites) place(labelRefs.current[s.clan.id], s.pos, 30);
      place(crossRef.current, CROSSROADS, 22);
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      controls.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((m) => m.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const pick = (id: string | null) => {
    setSelected(id);
    setHint(false);
    flyRef.current(id);
  };
  const sel = clanById(selected);
  const selSite = sites.find((s) => s.clan.id === selected);
  const visitClan = clanById(visiting);

  return (
    <div className="wm">
      <div ref={hostRef} className="wm-canvas" />

      <div className="wm-labels">
        {sites.map((s) => (
          <button
            key={s.clan.id}
            ref={(n) => { labelRefs.current[s.clan.id] = n; }}
            className={`wm-label ${selected === s.clan.id ? "on" : ""}`}
            style={{ "--c": s.clan.color } as React.CSSProperties}
            onClick={() => pick(s.clan.id)}
          >
            <ClanLogo clan={s.clan} size={26} />
            <span>{s.clan.name}</span>
          </button>
        ))}
        <div ref={crossRef} className="wm-label small">Crossroads</div>
      </div>

      <header className="wm-top">
        {onBack && <button className="wm-round" onClick={onBack} aria-label="Back">‹</button>}
        <div>
          <div className="wm-title">World Map</div>
          <div className="wm-sub">The three empires</div>
        </div>
      </header>

      {hint && !sel && <div className="wm-hint">Drag to move · pinch to zoom · tap an empire</div>}

      {sel && selSite ? (
        <div className="wm-card" style={{ "--c": sel.color } as React.CSSProperties}>
          <div className="wm-card-head">
            <ClanLogo clan={sel} size={44} />
            <div>
              <div className="wm-card-name">{sel.name}</div>
              <div className="wm-card-region">{selSite.region} · {WEATHER_WORD[sel.weather]}</div>
            </div>
            <button className="wm-round small" onClick={() => pick(null)} aria-label="Close">×</button>
          </div>
          <p className="wm-card-text">{selSite.blurb} <i>“{sel.motto}”</i></p>
          <button className="game-btn jade wide" onClick={() => setVisiting(sel.id)}>Visit palace</button>
        </div>
      ) : (
        <nav className="wm-chips">
          {CLANS.map((c) => (
            <button key={c.id} className="wm-chip" style={{ "--c": c.color } as React.CSSProperties} onClick={() => pick(c.id)}>
              <ClanLogo clan={c} size={22} />
              <span>{c.name}</span>
            </button>
          ))}
        </nav>
      )}

      {visitClan && (
        <div className="wm-visit">
          <Suspense fallback={null}>
            <Palace3D seed={visitClan.name} weather={visitClan.weather} style={visitClan.palace} />
          </Suspense>
          <header className="wm-top">
            <button className="wm-round" onClick={() => setVisiting(null)} aria-label="Back to the map">‹</button>
            <div>
              <div className="wm-title">{visitClan.name}</div>
              <div className="wm-sub">Back to the map</div>
            </div>
          </header>
        </div>
      )}
    </div>
  );
}
