// Every tunable number lives here.

// Rep detection
export const DOWN_ANGLE = 90; // elbow angle (deg) below which we are "down"
export const UP_ANGLE = 160; // elbow angle (deg) above which we are "up" again
export const SMOOTH_FRAMES = 4; // moving-average window for the elbow angle
export const MIN_VISIBILITY = 0.5; // avg landmark visibility needed to count
export const KNEE_LIFT = 0.2; // at the top of a rep the knee must be this high above the wrist (floor), as a fraction of shoulder-hip length. Knee push-ups score ~0
export const SIDE_SWITCH_MARGIN = 0.15; // the other side must be this much more visible before we switch arms
export const FRAME_MARGIN = 0.03; // shoulder/elbow/wrist/hip/knee must be this far inside the frame edge (0-1), else "move back"

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
