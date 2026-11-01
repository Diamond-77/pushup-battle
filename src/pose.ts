import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { FRAME_MARGIN, MEDIAPIPE_WASM_URL, MIN_VISIBILITY, POSE_MODEL_URL } from "./config";

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

const SHOULDERS = [11, 12];
const WRISTS = [15, 16];
const KNEES = [25, 26];

// shoulderHeight: pixels the shoulders are above the wrists. kneeHeight: pixels the knee is
// above the wrists, or null when no knee is clearly visible.
export type BodyReading = { visible: boolean; inFrame: boolean; shoulderHeight: number; kneeHeight: number | null };

// Visibility-weighted average y (pixels) of the points that are visible enough.
function avgY(lm: NormalizedLandmark[], ids: number[], height: number): number | null {
  let sum = 0, weight = 0;
  for (const i of ids) {
    const v = lm[i].visibility ?? 0;
    if (v < MIN_VISIBILITY) continue;
    sum += lm[i].y * height * v;
    weight += v;
  }
  return weight > 0 ? sum / weight : null;
}

// Uses both shoulders and both wrists (whichever are visible), so it doesn't matter
// which side faces the camera and there is no left/right switching.
export function readBody(lm: NormalizedLandmark[], height: number): BodyReading {
  const shoulderY = avgY(lm, SHOULDERS, height);
  const wristY = avgY(lm, WRISTS, height);
  if (shoulderY === null || wristY === null) return { visible: false, inFrame: false, shoulderHeight: 0, kneeHeight: null };

  const kneeY = avgY(lm, KNEES, height);
  const inside = (p: NormalizedLandmark) =>
    (p.visibility ?? 0) < MIN_VISIBILITY ||
    (p.x > FRAME_MARGIN && p.x < 1 - FRAME_MARGIN && p.y > FRAME_MARGIN && p.y < 1 - FRAME_MARGIN);
  return {
    visible: true,
    inFrame: [...SHOULDERS, ...WRISTS].every((i) => inside(lm[i])),
    shoulderHeight: wristY - shoulderY,
    kneeHeight: kneeY === null ? null : wristY - kneeY,
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
