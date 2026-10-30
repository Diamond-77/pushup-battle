import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { FRAME_MARGIN, MEDIAPIPE_WASM_URL, MIN_VISIBILITY, POSE_MODEL_URL, SIDE_SWITCH_MARGIN } from "./config";

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

export function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 1,
      });
    })();
  }
  return landmarkerPromise;
}

const ARM_LEFT = [11, 13, 15]; // shoulder, elbow, wrist
const ARM_RIGHT = [12, 14, 16];
const HIP = { left: 23, right: 24 };
const KNEE = { left: 25, right: 26 };

export type Side = "left" | "right";

// armAngle: shoulder-elbow-wrist.
// kneeLift: how high the knee is above the wrist (the wrist is on the floor), divided by
// shoulder-hip length so it doesn't depend on distance. Null if the knee isn't visible.
// inFrame is false when the arm, hip or knee is cut off by the frame edge (camera too close).
export type BodyReading = { side: Side; visibility: number; armAngle: number; kneeLift: number | null; inFrame: boolean };

// Uses the arm with higher visibility, but sticks with prevSide unless the other arm is
// clearly more visible, so the measured arm doesn't flip back and forth between frames.
// width/height convert normalized coords to pixels so the angles aren't skewed.
export function readBody(lm: NormalizedLandmark[], width: number, height: number, prevSide: Side | null): BodyReading {
  const vis = (ids: number[]) => ids.reduce((s, i) => s + (lm[i].visibility ?? 0), 0) / ids.length;
  const leftVis = vis(ARM_LEFT);
  const rightVis = vis(ARM_RIGHT);
  let side: Side = leftVis >= rightVis ? "left" : "right";
  if (prevSide && side !== prevSide && Math.abs(leftVis - rightVis) < SIDE_SWITCH_MARGIN) side = prevSide;

  const [shoulder, elbow, wrist] = (side === "left" ? ARM_LEFT : ARM_RIGHT).map((i) => lm[i]);
  const hip = lm[HIP[side]];
  const knee = lm[KNEE[side]];
  const torso = Math.hypot((shoulder.x - hip.x) * width, (shoulder.y - hip.y) * height);
  const kneeLift =
    (knee.visibility ?? 0) >= MIN_VISIBILITY && torso > 0 ? ((wrist.y - knee.y) * height) / torso : null;

  const inside = (p: NormalizedLandmark) =>
    p.x > FRAME_MARGIN && p.x < 1 - FRAME_MARGIN && p.y > FRAME_MARGIN && p.y < 1 - FRAME_MARGIN;
  return {
    side,
    visibility: side === "left" ? leftVis : rightVis,
    armAngle: angleAt(shoulder, elbow, wrist, width, height),
    kneeLift,
    inFrame: [shoulder, elbow, wrist, hip, knee].every(inside),
  };
}

// Simple stickman: head, shoulders, arms, torso, legs. Orange lines, white joints.
const STICK_LINES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // shoulders + arms
  [11, 23], [12, 24], [23, 24], // torso
  [23, 25], [25, 27], [24, 26], [26, 28], // legs
];
const STICK_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const DRAW_VISIBILITY = 0.3;

export function drawStickman(ctx: CanvasRenderingContext2D, lm: NormalizedLandmark[], w: number, h: number) {
  const seen = (i: number) => (lm[i].visibility ?? 0) >= DRAW_VISIBILITY;
  const scale = Math.max(2, w / 160);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#ff7a1a";
  ctx.lineWidth = scale * 1.5;
  for (const [a, b] of STICK_LINES) {
    if (!seen(a) || !seen(b)) continue;
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffffff";
  for (const i of STICK_JOINTS) {
    if (!seen(i)) continue;
    ctx.beginPath();
    ctx.arc(lm[i].x * w, lm[i].y * h, scale * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (seen(0)) {
    // head as a ring around the nose
    ctx.lineWidth = scale;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(lm[0].x * w, lm[0].y * h, scale * 6, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function angleAt(a: NormalizedLandmark, b: NormalizedLandmark, c: NormalizedLandmark, w: number, h: number) {
  const abx = (a.x - b.x) * w, aby = (a.y - b.y) * h;
  const cbx = (c.x - b.x) * w, cby = (c.y - b.y) * h;
  const deg = Math.abs((Math.atan2(cby, cbx) - Math.atan2(aby, abx)) * (180 / Math.PI));
  return deg > 180 ? 360 - deg : deg;
}
