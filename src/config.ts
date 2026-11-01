// Every tunable number lives here.

// Rep detection (shoulder based: shoulders and wrists are the easiest points to track, even in low light)
// "Shoulder height" = how far the shoulders are above the wrists (the wrists are on the floor).
// It is compared to the highest recent shoulder height (arms straight), so camera distance doesn't matter.
export const SHOULDER_DOWN = 0.6; // shoulders below 60% of the top height = "down"
export const SHOULDER_UP = 0.9; // back above 90% of the top height = "up", rep counted
export const TOP_DECAY = 0.998; // per frame, lets the remembered top height slowly adapt if you move
export const SMOOTH_FRAMES = 4; // moving-average window for the shoulder height
export const MIN_VISIBILITY = 0.5; // a shoulder and a wrist must be at least this visible to count
export const KNEE_LIFT = 0.2; // if a knee IS clearly visible at the top, it must be this high above the wrists (fraction of top height). Knees on the floor score ~0. A knee that can't be seen never blocks a rep
// Hidden "are you in push-up position" check (rough on purpose, uses loosely tracked hips/ankles).
// Both ratios are divided by how far the wrists are below the shoulders. Standing scores ~1, a plank ~0.
export const POSITION_VISIBILITY = 0.3; // hips/ankles count for this check above this visibility (lower = works in the dark)
export const HIP_DROP_MAX = 0.5; // hips may be at most this far below the shoulders
export const ANKLE_DROP_MAX = 0.6; // ankles may be at most this far below the wrists
export const FRAME_MARGIN = 0.02; // shoulder/wrist must be this far inside the frame edge (0-1)
export const REP_FLASH_MS = 350; // how long the screen border flashes bright green after a rep

// Camera (lower resolution = faster pose detection)
export const CAMERA_WIDTH = 640;
export const CAMERA_HEIGHT = 480;
export const DEBUG_UPDATE_MS = 100; // how often the debug panel re-renders

// UI
export const METER_SEGMENTS = 7; // blocks in the depth meter on the right

// Tug-of-war bar
export const BAR_START = 50;
export const BAR_STEP = 5;

// Match timing
export const MATCH_SECONDS = 30;
export const COUNTDOWN_SECONDS = 3;

// MediaPipe assets (from the official Pose Landmarker web guide).
// WASM version is pinned to the installed @mediapipe/tasks-vision version.
export const MEDIAPIPE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm";
export const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
