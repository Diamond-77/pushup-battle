import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CAMERA_HEIGHT,
  CAMERA_WIDTH,
  DEBUG_UPDATE_MS,
  EXIT_FRAMES,
  KNEE_LIFT,
  LOST_MS,
  SETTLE_MS,
  METER_SEGMENTS,
  REP_FLASH_MS,
  SHOULDER_DOWN,
  SHOULDER_UP,
  SMOOTH_FRAMES,
  TOP_DECAY,
  WRIST_MOVE_MAX,
  FAST_DOWN,
  FAST_HOLD_MS,
  FAST_REP_MS,
  FAST_SMOOTH_FRAMES,
  FAST_UP,
  FAST_WRIST_MOVE_MAX,
  MIN_REP_MS,
  LOCK_CHECK_FRAMES,
  LOCK_JUMP,
  LOCK_LEARN_FRAMES,
  LOCK_MAX_DIFF,
  KNEE_BENT_DEG,
  KNEE_CHECK_EVERY_MS,
  KNEE_CHECK_FRAMES,
  KNEE_SAMPLE_FRAMES,
  KNEE_STRAIGHT_DEG,
} from "./config";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { bodySignature, drawStickman, getPoseLandmarker, kneeAngle, medianSignature, readBody, signatureDiff, type BodySignature } from "./pose";

type Status = "ok" | "not_detected" | "too_close" | "not_in_position" | "knee_down" | "switched";
type Debug = { ratio: number | null; kneeLift: number | null; state: "up" | "down"; reps: number; fps: number; status: Status; fast: boolean; lock: string };
type LockPhase = "off" | "learning" | "locked" | "jump" | "checking" | "switched";

type Props = {
  counting: boolean; // only report reps to the match while this is true
  onRep: () => void;
  facing: "user" | "environment";
  children?: ReactNode; // overlays (HUD, pages, dock) drawn over the camera
  paused?: boolean; // a full page covers the camera: skip tracking to save battery and GPU
  lockBody?: boolean; // battle running: the body that started must finish (anti-cheat)
};

export default function PoseCounter({ counting, onRep, facing, children, paused = false, lockBody = false }: Props) {
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const lockBodyRef = useRef(lockBody);
  lockBodyRef.current = lockBody;
  const [switched, setSwitched] = useState(false);
  // knee check (battles only): next check time, frames of straight / bent legs, and whether we're waiting for knees up
  const knee = useRef({ nextAt: 0, sampled: 0, bent: 0, straight: 0, asking: false, flags: 0, ang: null as number | null });
  const [kneeAsk, setKneeAsk] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const meterLabelRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [camDenied, setCamDenied] = useState(false); // camera permission refused: show the help popup
  const [camTry, setCamTry] = useState(0); // bump to ask for the camera again
  // Ask for the camera only after the player taps "Allow camera" (or it was allowed before),
  // so the browser's prompt never pops up by surprise and gets blocked by accident.
  const [camWanted, setCamWanted] = useState(() => {
    try { return localStorage.getItem("pb_cam_ok") === "1"; } catch { return false; }
  });
  useEffect(() => {
    navigator.permissions?.query({ name: "camera" as PermissionName }).then((p) => {
      if (p.state === "granted") setCamWanted(true);
      if (p.state === "denied") setCamDenied(true);
    }).catch(() => {});
  }, []);
  // Tapped inside the button, so the browser shows its own "Allow camera?" prompt.
  const askCamera = async () => {
    try {
      const test = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      test.getTracks().forEach((t) => t.stop());
      try { localStorage.setItem("pb_cam_ok", "1"); } catch { /* ignore */ }
      setCamDenied(false);
      setCamWanted(true);
      setCamTry((n) => n + 1);
    } catch (e) {
      const name = (e as Error).name;
      if (name === "NotAllowedError" || name === "SecurityError") setCamDenied(true);
      else setError("The camera couldn't start. Close other apps using it and try again.");
    }
  };
  const [loading, setLoading] = useState(true);
  const [debug, setDebug] = useState<Debug>({ ratio: null, kneeLift: null, state: "up", reps: 0, fps: 0, status: "not_detected", fast: false, lock: "off" });

  // Rep state lives in refs so the frame loop never sees stale values.
  const stateRef = useRef<"up" | "down">("up");
  const repsRef = useRef(0);
  const heightsRef = useRef<number[]>([]); // recent shoulder heights, for smoothing
  const topRef = useRef(0); // highest recent shoulder height (arms straight)
  const screenRef = useRef<HTMLDivElement>(null);
  const lastRepAtRef = useRef(0);
  // Position gate: confirmed once (hips + legs look like a plank), then held until you clearly leave.
  const inPositionRef = useRef(false);
  const standingFramesRef = useRef(0);
  const lostSinceRef = useRef<number | null>(null);
  const enteredAtRef = useRef(0);
  const downWristRef = useRef({ x: 0, y: 0 }); // where the hands were when the rep went down
  // Fast mode: on while reps come quickly (see FAST_* in config)
  const fastUntilRef = useRef(0);
  const rawRef = useRef<{ t: number; r: number }[]>([]); // unsmoothed height ratio over the last moments
  // Body lock
  const lock = useRef({
    phase: "off" as LockPhase,
    base: null as BodySignature | null,
    frames: [] as BodySignature[],
    lastPos: null as { x: number; y: number } | null,
    lastSeen: 0,
    jumpFrom: { x: 0, y: 0 },
    jumpFrames: 0,
  });
  // Latest props in refs so the frame loop (started once) always sees current values.
  const countingRef = useRef(counting);
  const onRepRef = useRef(onRep);
  countingRef.current = counting;
  onRepRef.current = onRep;

  // Camera + wake lock
  useEffect(() => {
    if (!camWanted) return;
    let stream: MediaStream | null = null;
    let wakeLock: WakeLockSentinel | null = null;
    let cancelled = false;

    const requestWakeLock = async () => {
      try {
        wakeLock = await navigator.wakeLock?.request("screen");
      } catch {
        // Not supported or denied; the app still works.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && stream) requestWakeLock();
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: CAMERA_WIDTH }, height: { ideal: CAMERA_HEIGHT } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setError(null);
        setCamDenied(false);
        requestWakeLock();
      } catch (e) {
        const name = (e as Error).name;
        if (name === "NotAllowedError" || name === "SecurityError") setCamDenied(true);
        else setError(name === "NotFoundError" ? "No camera found on this device." : "The camera couldn't start. Close other apps using it and try again.");
      }
    })();
    // When the player turns the camera on in settings, start right away.
    let perm: PermissionStatus | null = null;
    const onPerm = () => perm?.state === "granted" && setCamTry((n) => n + 1);
    navigator.permissions?.query({ name: "camera" as PermissionName }).then((p) => { perm = p; p.addEventListener("change", onPerm); }).catch(() => {});
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      perm?.removeEventListener("change", onPerm);
      stream?.getTracks().forEach((t) => t.stop());
      wakeLock?.release().catch(() => {});
    };
  }, [facing, camTry, camWanted]);

  // Pose detection loop
  useEffect(() => {
    let raf = 0;
    let stopped = false;
    let lastVideoTime = -1;
    let lastFrame = performance.now();
    let fps = 0;
    let lastDebug = 0;

    // The camera picture is drawn immediately; pose tracking joins in once the model has loaded.
    let landmarker: PoseLandmarker | null = null;
    getPoseLandmarker()
      .then((l) => {
        landmarker = l;
        setLoading(false);
      })
      .catch((e) => {
        setLoading(false);
        setError(`Pose model error: ${(e as Error)?.message ?? String(e)}`);
      });

    const loop = () => {
      if (stopped) return;
      raf = requestAnimationFrame(loop);
      if (pausedRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      const now = performance.now();
      fps = fps * 0.9 + (1000 / Math.max(1, now - lastFrame)) * 0.1;
      lastFrame = now;

      const w = video.videoWidth, h = video.videoHeight;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      const result = landmarker?.detectForVideo(video, now);

      ctx.save();
      if (facing === "user") {
        ctx.translate(w, 0);
        ctx.scale(-1, 1); // mirror the selfie view
      }
      ctx.drawImage(video, 0, 0, w, h);
      const lm = result?.landmarks[0];
      if (lm) {
        drawStickman(ctx, lm, w, h);
      }
      ctx.restore();
      if (!landmarker) return; // camera shows right away; tracking starts once the model is ready

      let ratio: number | null = null;
      let kneeLift: number | null = null;
      let status: Status = "not_detected";
      const body = lm ? readBody(lm, w, h) : null;
      const L = lock.current;
      if (!(lockBodyRef.current && countingRef.current) && (knee.current.asking || knee.current.nextAt)) {
        knee.current = { nextAt: 0, sampled: 0, bent: 0, straight: 0, asking: false, flags: 0, ang: null };
        setKneeAsk(false);
      }
      if (!lockBodyRef.current) {
        if (L.phase !== "off") { L.phase = "off"; L.base = null; L.frames = []; L.lastPos = null; setSwitched(false); }
      } else if (body?.visible && lm && result?.worldLandmarks[0]) {
        if (L.phase === "off") { L.phase = "learning"; L.frames = []; }
        const sig = bodySignature(result.worldLandmarks[0], lm);
        const pos = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
        const dist = (a: { x: number; y: number }) => Math.hypot(pos.x - a.x, pos.y - a.y);
        const returned = now - L.lastSeen > LOST_MS; // the body was gone for a while: maybe someone else came in
        const compare = () => signatureDiff(medianSignature(L.frames), L.base!);
        if (L.phase === "learning") {
          if (body.inFrame) L.frames.push(sig);
          if (L.frames.length >= LOCK_LEARN_FRAMES) {
            L.base = medianSignature(L.frames);
            L.phase = "locked";
          }
        } else if (L.phase === "locked") {
          const moved = L.lastPos !== null && dist(L.lastPos) > LOCK_JUMP;
          const gap = now - L.lastSeen;
          // A jump between back-to-back frames = the tracker switched people. After a short gap the
          // same person may simply have moved, so then the body proportions decide instead.
          if (returned || (moved && gap > 200)) { L.phase = "checking"; L.frames = []; }
          else if (moved) { L.phase = "jump"; L.jumpFrom = L.lastPos!; L.jumpFrames = 0; }
        } else if (L.phase === "jump") {
          // One glitchy frame jumps back; a real switch to another person stays put.
          if (dist(L.jumpFrom) < LOCK_JUMP / 2) L.phase = "locked";
          else if (++L.jumpFrames >= 6) { L.phase = "switched"; L.frames = []; setSwitched(true); }
        } else if (L.phase === "checking") {
          L.frames.push(sig);
          if (L.frames.length >= LOCK_CHECK_FRAMES) {
            const d = compare();
            if (d !== null && d > LOCK_MAX_DIFF) { L.phase = "switched"; setSwitched(true); }
            else L.phase = "locked";
            L.frames = [];
          }
        } else if (L.phase === "switched") {
          // Unlock only when the original body is clearly back.
          L.frames.push(sig);
          if (L.frames.length >= LOCK_CHECK_FRAMES) {
            const d = compare();
            if (d !== null && d < LOCK_MAX_DIFF * 0.6) { L.phase = "locked"; setSwitched(false); }
            L.frames = [];
          }
        }
        L.lastPos = pos;
        L.lastSeen = now;
      }
      if (body?.visible && body.inFrame) {
        lostSinceRef.current = null;
        if (!inPositionRef.current && body.enterPosition) {
          inPositionRef.current = true;
          standingFramesRef.current = 0;
          topRef.current = 0; // re-learn the "arms straight" height for this set
          enteredAtRef.current = now;
          stateRef.current = "up";
        }
        if (inPositionRef.current) {
          standingFramesRef.current = body.standing ? standingFramesRef.current + 1 : 0;
          if (standingFramesRef.current >= EXIT_FRAMES) inPositionRef.current = false;
        }
        status = inPositionRef.current ? "ok" : "not_in_position";
        if (L.phase === "switched") status = "switched";
      } else {
        if (body?.visible) status = "too_close";
        lostSinceRef.current ??= now;
        if (now - lostSinceRef.current > LOST_MS) inPositionRef.current = false;
      }

      let fast = now < fastUntilRef.current;
      let downAt = fast ? FAST_DOWN : SHOULDER_DOWN;
      let upAt = fast ? FAST_UP : SHOULDER_UP;
      if (body && status === "ok") {
        const buf = heightsRef.current;
        buf.push(body.shoulderHeight);
        if (buf.length > SMOOTH_FRAMES) buf.shift();
        const recent = fast ? buf.slice(-FAST_SMOOTH_FRAMES) : buf; // fast mode: less smoothing, less lag
        const height = recent.reduce((s, a) => s + a, 0) / recent.length;
        topRef.current = Math.max(topRef.current * TOP_DECAY, height);
        ratio = topRef.current > 0 ? height / topRef.current : 1;

        // Hint of speed: the shoulders travel a big distance in a short moment.
        // Tiny wiggles never travel this far, so they can't switch fast mode on.
        if (topRef.current > 0) {
          const raw = rawRef.current;
          raw.push({ t: now, r: body.shoulderHeight / topRef.current });
          while (raw.length && now - raw[0].t > 250) raw.shift();
          let lo = Infinity, hi = -Infinity;
          for (const p of raw) { lo = Math.min(lo, p.r); hi = Math.max(hi, p.r); }
          if (hi - lo > 0.3 && now - enteredAtRef.current > SETTLE_MS) {
            fastUntilRef.current = Math.max(fastUntilRef.current, now + FAST_HOLD_MS);
            fast = true;
            downAt = FAST_DOWN;
            upAt = FAST_UP;
          }
        }

        // A knee that can't be seen never blocks a rep; a visible knee on the floor does.
        kneeLift = body.kneeHeight === null || topRef.current <= 0 ? null : body.kneeHeight / topRef.current;
        let kneeOk = kneeLift === null || kneeLift >= KNEE_LIFT;

        // Fair play in battles: a silent knee check every few seconds, using the 3D knee bend
        // (works from the front). Nothing shows unless the knees are found down.
        const K = knee.current;
        if (lockBodyRef.current && countingRef.current && result?.worldLandmarks[0] && lm) {
          if (K.nextAt === 0) K.nextAt = now + KNEE_CHECK_EVERY_MS;
          const checking = !K.asking && now >= K.nextAt;
          if (checking || K.asking) {
            const ang = kneeAngle(result.worldLandmarks[0], lm);
            K.ang = ang;
            if (checking) {
              K.sampled++;
              if (ang !== null && ang < KNEE_BENT_DEG) K.bent++;
              if (K.sampled >= KNEE_SAMPLE_FRAMES) {
                if (K.bent > K.sampled / 2) { K.asking = true; K.flags++; K.straight = 0; setKneeAsk(true); }
                else K.nextAt = now + KNEE_CHECK_EVERY_MS;
                K.sampled = 0;
                K.bent = 0;
              }
            } else {
              K.straight = ang !== null && ang >= KNEE_STRAIGHT_DEG ? K.straight + 1 : 0;
              if (K.straight >= KNEE_CHECK_FRAMES) { K.asking = false; K.nextAt = now + KNEE_CHECK_EVERY_MS; setKneeAsk(false); }
            }
          }
          if (K.asking) kneeOk = false;
        }
        if (!kneeOk) status = "knee_down";

        const settled = now - enteredAtRef.current > SETTLE_MS; // e.g. still putting the phone down
        if (stateRef.current === "up" && ratio < downAt && settled) {
          stateRef.current = "down";
          downWristRef.current = body.wrist;
        } else if (stateRef.current === "down" && ratio > upAt) {
          stateRef.current = "up";
          // Hands stay planted in a real push-up; if they "moved", the camera or the person moved instead.
          const moved = Math.hypot(body.wrist.x - downWristRef.current.x, body.wrist.y - downWristRef.current.y);
          const planted = moved < (fast ? FAST_WRIST_MOVE_MAX : WRIST_MOVE_MAX) * topRef.current;
          const sinceLast = now - lastRepAtRef.current;
          if (kneeOk && planted && sinceLast > MIN_REP_MS) {
            if (sinceLast < FAST_REP_MS || fast) fastUntilRef.current = now + FAST_HOLD_MS;
            repsRef.current += 1;
            lastRepAtRef.current = now;
            if (countingRef.current) onRepRef.current();
          }
        }
      } else {
        heightsRef.current = []; // don't mix stale heights in when tracking comes back
        rawRef.current = [];
        if (status === "not_in_position") stateRef.current = "up"; // standing up cancels a half-done rep
      }

      // Screen border: green = tracking you, red = not tracking / knees down, bright flash = rep counted.
      const screen = screenRef.current;
      if (screen) {
        screen.classList.toggle("track-ok", status === "ok");
        screen.classList.toggle("track-bad", status !== "ok");
        screen.classList.toggle("rep-flash", now - lastRepAtRef.current < REP_FLASH_MS);
      }

      // Depth meter: 0% with arms straight, 100% once the shoulders are low enough to count.
      // Updated straight on the DOM every frame so it never lags behind the body.
      const depth =
        ratio === null ? 0 : Math.min(1, Math.max(0, (upAt - ratio) / (upAt - downAt)));
      if (meterRef.current) {
        const lit = Math.round(depth * METER_SEGMENTS);
        const blocks = meterRef.current.children;
        // children are ordered top to bottom; light them from the bottom up
        for (let i = 0; i < blocks.length; i++) blocks[i].classList.toggle("on", blocks.length - i <= lit);
        meterRef.current.classList.toggle("reached", stateRef.current === "down");
      }
      if (meterLabelRef.current) meterLabelRef.current.textContent = `${Math.round(depth * 100)}%`;

      // Re-render the debug panel at a limited rate so React doesn't steal frame time.
      if (now - lastDebug > DEBUG_UPDATE_MS) {
        lastDebug = now;
        setDebug({ ratio, kneeLift, state: stateRef.current, reps: repsRef.current, fps, status, fast, lock: L.phase });
      }
    };
    loop();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [facing]);

  return (
    <div className={`screen track-bad ${switched ? "body-switch" : ""}`} ref={screenRef}>
      <video ref={videoRef} playsInline muted className="hidden-video" />
      <canvas ref={canvasRef} className="view" />
      <div className="vignette" />

      {children}

      <div className="meter-wrap">
        <div className="meter" ref={meterRef}>
          {Array.from({ length: METER_SEGMENTS }, (_, i) => (
            <div key={i} className="block" />
          ))}
        </div>
        <div className="meter-label" ref={meterLabelRef}>0%</div>
      </div>

      <div className="center">
        {loading && <div className="toast">Starting tracker…</div>}
        {error && <div className="toast error">{error}</div>}
      </div>
      {!paused && !camWanted && !camDenied && <CameraAsk onAllow={askCamera} />}
      {camDenied && !paused && <CameraHelp onRetry={askCamera} />}
      {kneeAsk && !switched && (
        <div className="knee-ask" role="alert">
          <svg viewBox="0 0 24 24" width="110" height="110" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20V5M5 11l7-7 7 7" />
          </svg>
          <div className="knee-ask-title">Knees up</div>
        </div>
      )}
      {switched && (
        <div className="switch-warning">
          <div className="switch-title">Switching body</div>
          <div>A different person is in front of the camera. Paused until the player who started comes back.</div>
        </div>
      )}

      {/* Debug panel: laptop/desktop only (hidden on phones by CSS) */}
      <div className="debug">
        <div>Height <b>{debug.ratio === null ? "–" : `${Math.round(debug.ratio * 100)}%`}</b></div>
        <div>State <b>{debug.state}</b></div>
        <div>Reps <b>{debug.reps}</b></div>
        <div>FPS <b>{debug.fps.toFixed(0)}</b></div>
        <div>Track <b>{debug.status}</b></div>
        <div>Knee <b>{debug.kneeLift === null ? "–" : debug.kneeLift.toFixed(2)}</b></div>
        <div>Knee° <b>{knee.current.ang === null ? "–" : Math.round(knee.current.ang)}</b></div>
        <div>Fast <b>{debug.fast ? "on" : "off"}</b></div>
        <div>Lock <b>{debug.lock}</b></div>
      </div>

    </div>
  );
}

// Before the browser asks: explain why, then the player taps to get the real prompt.
function CameraAsk({ onAllow }: { onAllow: () => void }) {
  return (
    <div className="modal-back cam-help">
      <div className="modal panel">
        <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="#3fbf8a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7h3l2-2h8l2 2h3v12H3z" /><circle cx="12" cy="13" r="3.5" />
        </svg>
        <div className="modal-title">Turn on your camera</div>
        <p className="modal-text">The camera watches your push-ups and counts every rep. Nothing is recorded or sent anywhere.</p>
        <p className="modal-text small-note">Next, your browser asks. Tap <b>Allow</b>.</p>
        <button className="game-btn jade big wide" onClick={onAllow}>Allow camera</button>
      </div>
    </div>
  );
}

// Shown when camera access was refused. A website can't open the phone's settings itself,
// so it shows the steps as little pictures of the browser, plus a button to ask again.
function CameraHelp({ onRetry }: { onRetry: () => void }) {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const Bar = ({ hot }: { hot: "tune" | "aa" }) => (
    <div className="mock-bar">
      {hot === "aa" && <span className="mock-hot">aA</span>}
      {hot === "tune" && (
        <span className="mock-hot">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
        </span>
      )}
      <span className="mock-url">pushup-battle…</span>
    </div>
  );
  const Row = ({ label, on }: { label: string; on?: boolean }) => (
    <div className="mock-row"><span>{label}</span>{on !== undefined && <i className={`mock-toggle ${on ? "on" : ""}`} />}</div>
  );
  const steps = ios
    ? [
        { pic: <Bar hot="aa" />, text: "Tap aA in the address bar" },
        { pic: <Row label="Website Settings" />, text: "Tap Website Settings" },
        { pic: <Row label="Camera: Allow" on />, text: "Set Camera to Allow" },
      ]
    : android
      ? [
          { pic: <div className="mock-bar menu"><span className="mock-url">pushup-battle…</span><span className="mock-hot">⋮</span></div>, text: "Tap the ⋮ menu at the top right of Chrome" },
          { pic: <div className="mock-bar menu"><span className="mock-url">← ☆ ⬇</span><span className="mock-hot">ⓘ</span><span className="mock-url">↻</span></div>, text: "Tap the ⓘ in the top row of the menu" },
          { pic: <Row label="Permissions → Camera" on />, text: "Tap Permissions, turn Camera on" },
        ]
      : [
          { pic: <Bar hot="tune" />, text: "Click the icon left of the web address" },
          { pic: <Row label="Camera" on />, text: "Turn Camera on" },
        ];
  return (
    <div className="modal-back cam-help">
      <div className="modal panel">
        <div className="modal-title">Camera is blocked</div>
        <p className="modal-text">Your browser said no to the camera. Turn it back on in {steps.length} taps:</p>
        <ol className="cam-steps">
          {steps.map((st, i) => (
            <li key={i}>
              <span className="cam-no">{i + 1}</span>
              <div className="cam-step">{st.pic}<span>{st.text}</span></div>
            </li>
          ))}
        </ol>
        <button className="game-btn jade wide" onClick={onRetry}>I turned it on, try again</button>
      </div>
    </div>
  );
}
