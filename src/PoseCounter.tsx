import { useEffect, useRef, useState } from "react";
import {
  CAMERA_HEIGHT,
  CAMERA_WIDTH,
  DEBUG_UPDATE_MS,
  DOWN_ANGLE,
  KNEE_LIFT,
  METER_SEGMENTS,
  MIN_VISIBILITY,
  SMOOTH_FRAMES,
  UP_ANGLE,
} from "./config";
import Hud from "./Hud";
import { drawStickman, getPoseLandmarker, readBody, type Side } from "./pose";

type Status = "ok" | "not_detected" | "too_close" | "knee_down";
type Debug = { angle: number | null; kneeLift: number | null; state: "up" | "down"; reps: number; fps: number; status: Status };

export default function PoseCounter() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const meterLabelRef = useRef<HTMLDivElement>(null);
  const [showDebug, setShowDebug] = useState(true);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [debug, setDebug] = useState<Debug>({ angle: null, kneeLift: null, state: "up", reps: 0, fps: 0, status: "not_detected" });

  // Rep state lives in refs so the frame loop never sees stale values.
  const stateRef = useRef<"up" | "down">("up");
  const repsRef = useRef(0);
  const anglesRef = useRef<number[]>([]);
  const sideRef = useRef<Side | null>(null);

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

          let angle: number | null = null;
          let kneeLift: number | null = null;
          let status: Status = "not_detected";
          const body = lm ? readBody(lm, w, h, sideRef.current) : null;
          if (body && body.visibility >= MIN_VISIBILITY) status = body.inFrame ? "ok" : "too_close";

          if (body && status === "ok") {
            if (body.side !== sideRef.current) anglesRef.current = []; // never average two different arms
            sideRef.current = body.side;
            kneeLift = body.kneeLift;
            const kneeUp = kneeLift !== null && kneeLift >= KNEE_LIFT;
            if (!kneeUp) status = "knee_down";

            const buf = anglesRef.current;
            buf.push(body.armAngle);
            if (buf.length > SMOOTH_FRAMES) buf.shift();
            angle = buf.reduce((s, a) => s + a, 0) / buf.length;

            if (stateRef.current === "up" && angle < DOWN_ANGLE) {
              stateRef.current = "down";
            } else if (stateRef.current === "down" && angle > UP_ANGLE) {
              stateRef.current = "up";
              if (kneeUp) repsRef.current += 1; // knee on the floor at the top = knee push-up, no point
            }
          } else {
            anglesRef.current = []; // don't mix stale angles in when tracking comes back
          }

          // Depth meter: 0% at UP_ANGLE (arms straight), 100% at DOWN_ANGLE (deep enough to count).
          // Updated straight on the DOM every frame so it never lags behind the body.
          const depth = angle === null ? 0 : Math.min(1, Math.max(0, (UP_ANGLE - angle) / (UP_ANGLE - DOWN_ANGLE)));
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
            setDebug({ angle, kneeLift, state: stateRef.current, reps: repsRef.current, fps, status });
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

  const reset = () => {
    repsRef.current = 0;
    stateRef.current = "up";
    anglesRef.current = [];
  };

  const live = !loading && !error;
  let toast: string | null = null;
  if (loading) toast = "Loading pose model…";
  else if (live && debug.status === "not_detected") toast = "Body not detected";
  else if (live && debug.status === "too_close") toast = "Too close, move the camera back";
  else if (live && debug.status === "knee_down") toast = "Knees down, lift them off the floor";

  return (
    <div className="screen">
      <video ref={videoRef} playsInline muted className="hidden-video" />
      <canvas ref={canvasRef} className="view" />
      <div className="vignette" />

      <Hud myReps={debug.reps} oppReps={0} />

      <div className="meter-wrap">
        <div className="meter" ref={meterRef}>
          {Array.from({ length: METER_SEGMENTS }, (_, i) => (
            <div key={i} className="block" />
          ))}
        </div>
        <div className="meter-label" ref={meterLabelRef}>0%</div>
      </div>

      <div className="center">
        {toast && <div className={`toast ${loading ? "" : "warn"}`}>{toast}</div>}
        {live && (debug.status === "not_detected" || debug.status === "too_close") && (
          <div className="guide">
            Put the phone on the floor about 2 m away, side-on, so it sees your arm and knee.
            Your whole body should fit in the picture.
          </div>
        )}
        {error && <div className="toast error">{error}</div>}
      </div>

      {showDebug && (
        <div className="debug">
          <div>Angle <b>{debug.angle === null ? "–" : debug.angle.toFixed(0)}°</b></div>
          <div>State <b>{debug.state}</b></div>
          <div>Reps <b>{debug.reps}</b></div>
          <div>FPS <b>{debug.fps.toFixed(0)}</b></div>
          <div>Knee <b>{debug.kneeLift === null ? "–" : debug.kneeLift.toFixed(2)}</b></div>
          <button className="mini" onClick={reset}>Reset</button>
        </div>
      )}

      <div className="dock">
        <button className="dock-side" onClick={() => setShowDebug((v) => !v)}>
          {showDebug ? "Hide debug" : "Debug"}
        </button>
        <button
          className="dock-cam"
          aria-label="Switch camera"
          onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
        >
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.6l1.6-2.2h6.6L16.9 7h2.6A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
            <circle cx="12" cy="13" r="3.6" />
          </svg>
        </button>
        <div className="dock-side right">{facing === "user" ? "Front" : "Back"}</div>
      </div>
    </div>
  );
}
