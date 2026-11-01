import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CAMERA_HEIGHT,
  CAMERA_WIDTH,
  DEBUG_UPDATE_MS,
  KNEE_LIFT,
  METER_SEGMENTS,
  REP_FLASH_MS,
  SHOULDER_DOWN,
  SHOULDER_UP,
  SMOOTH_FRAMES,
  TOP_DECAY,
} from "./config";
import { drawStickman, getPoseLandmarker, readBody } from "./pose";

type Status = "ok" | "not_detected" | "too_close" | "knee_down";
type Debug = { ratio: number | null; kneeLift: number | null; state: "up" | "down"; reps: number; fps: number; status: Status };

type Props = {
  counting: boolean; // only report reps to the match while this is true
  onRep: () => void;
  children?: ReactNode; // match overlays (HUD, countdown, result) drawn over the camera
};

export default function PoseCounter({ counting, onRep, children }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const meterLabelRef = useRef<HTMLDivElement>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [debug, setDebug] = useState<Debug>({ ratio: null, kneeLift: null, state: "up", reps: 0, fps: 0, status: "not_detected" });

  // Rep state lives in refs so the frame loop never sees stale values.
  const stateRef = useRef<"up" | "down">("up");
  const repsRef = useRef(0);
  const heightsRef = useRef<number[]>([]); // recent shoulder heights, for smoothing
  const topRef = useRef(0); // highest recent shoulder height (arms straight)
  const screenRef = useRef<HTMLDivElement>(null);
  const lastRepAtRef = useRef(0);
  // Latest props in refs so the frame loop (started once) always sees current values.
  const countingRef = useRef(counting);
  const onRepRef = useRef(onRep);
  countingRef.current = counting;
  onRepRef.current = onRep;

  // Camera + wake lock
  useEffect(() => {
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
        requestWakeLock();
      } catch (e) {
        setError(`Camera error: ${(e as Error).message}`);
      }
    })();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      stream?.getTracks().forEach((t) => t.stop());
      wakeLock?.release().catch(() => {});
    };
  }, [facing]);

  // Pose detection loop
  useEffect(() => {
    let raf = 0;
    let stopped = false;
    let lastVideoTime = -1;
    let lastFrame = performance.now();
    let fps = 0;
    let lastDebug = 0;

    getPoseLandmarker()
      .then((landmarker) => {
        setLoading(false);
        const loop = () => {
          if (stopped) return;
          raf = requestAnimationFrame(loop);
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
          const result = landmarker.detectForVideo(video, now);

          ctx.save();
          if (facing === "user") {
            ctx.translate(w, 0);
            ctx.scale(-1, 1); // mirror the selfie view
          }
          ctx.drawImage(video, 0, 0, w, h);
          const lm = result.landmarks[0];
          if (lm) {
            drawStickman(ctx, lm, w, h);
          }
          ctx.restore();

          let ratio: number | null = null;
          let kneeLift: number | null = null;
          let status: Status = "not_detected";
          const body = lm ? readBody(lm, h) : null;
          if (body?.visible) status = body.inFrame ? "ok" : "too_close";

          if (body && status === "ok") {
            const buf = heightsRef.current;
            buf.push(body.shoulderHeight);
            if (buf.length > SMOOTH_FRAMES) buf.shift();
            const height = buf.reduce((s, a) => s + a, 0) / buf.length;
            topRef.current = Math.max(topRef.current * TOP_DECAY, height);
            ratio = topRef.current > 0 ? height / topRef.current : 1;

            // A knee that can't be seen never blocks a rep; a visible knee on the floor does.
            kneeLift = body.kneeHeight === null || topRef.current <= 0 ? null : body.kneeHeight / topRef.current;
            const kneeOk = kneeLift === null || kneeLift >= KNEE_LIFT;
            if (!kneeOk) status = "knee_down";

            if (stateRef.current === "up" && ratio < SHOULDER_DOWN) {
              stateRef.current = "down";
            } else if (stateRef.current === "down" && ratio > SHOULDER_UP) {
              stateRef.current = "up";
              if (kneeOk) {
                repsRef.current += 1;
                lastRepAtRef.current = now;
                if (countingRef.current) onRepRef.current();
              }
            }
          } else {
            heightsRef.current = []; // don't mix stale heights in when tracking comes back
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
            ratio === null ? 0 : Math.min(1, Math.max(0, (SHOULDER_UP - ratio) / (SHOULDER_UP - SHOULDER_DOWN)));
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
            setDebug({ ratio, kneeLift, state: stateRef.current, reps: repsRef.current, fps, status });
          }
        };
        loop();
      })
      .catch((e) => { setLoading(false); setError(`Pose model error: ${(e as Error)?.message ?? String(e)}`); });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [facing]);

  return (
    <div className="screen track-bad" ref={screenRef}>
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
        {loading && <div className="toast">Loading pose model…</div>}
        {error && <div className="toast error">{error}</div>}
      </div>

      {/* Debug panel: laptop/desktop only (hidden on phones by CSS) */}
      <div className="debug">
        <div>Height <b>{debug.ratio === null ? "–" : `${Math.round(debug.ratio * 100)}%`}</b></div>
        <div>State <b>{debug.state}</b></div>
        <div>Reps <b>{debug.reps}</b></div>
        <div>FPS <b>{debug.fps.toFixed(0)}</b></div>
        <div>Track <b>{debug.status}</b></div>
        <div>Knee <b>{debug.kneeLift === null ? "–" : debug.kneeLift.toFixed(2)}</b></div>
      </div>

      <nav className="dock">
        {/* Side icons are placeholders for future pages */}
        <div className="dock-group">
          <button className="dock-icon active" aria-label="Home">
            <svg viewBox="0 0 24 24"><path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z" /></svg>
          </button>
          <button className="dock-icon" aria-label="Leaderboard">
            <svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" /></svg>
          </button>
        </div>
        <button
          className="dock-cam"
          aria-label="Flip camera"
          onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
        >
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
            <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.6l1.6-2.2h6.6L16.9 7h2.6A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
            <path d="M9.2 12.2a3 3 0 0 1 5.3-1.2M14.8 13.8a3 3 0 0 1-5.3 1.2M14.6 9.6v1.6H13M9.4 16.4v-1.6H11" />
          </svg>
        </button>
        <div className="dock-group">
          <button className="dock-icon" aria-label="Friends">
            <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.4c2 .8 3.5 2.8 3.5 5.6" /></svg>
          </button>
          <button className="dock-icon" aria-label="Profile">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
          </button>
        </div>
      </nav>
    </div>
  );
}
