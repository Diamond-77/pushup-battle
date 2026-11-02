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
// "Are you in push-up position" gate (rough on purpose, uses loosely tracked hips/legs).
// Once confirmed, counting only uses the shoulders until you clearly leave the position.
// Ratios are divided by how far the wrists are below the shoulders: standing ~1, side plank ~0.3, front plank ~0.5.
export const POSITION_VISIBILITY = 0.3; // hips/legs count as "seen" above this visibility (lower = works in the dark)
export const HIP_DROP_MAX = 0.8; // to ENTER: hips at most this far below the shoulders
export const LEG_DROP_MAX = 0.6; // to ENTER: ankle (or knee) at most this far below the wrists
export const STAND_HIP = 1.0; // to LEAVE: hips this far below the shoulders = standing
export const STAND_LEG = 1.0; // to LEAVE: ankle/knee this far below the wrists = standing
export const EXIT_FRAMES = 10; // must look like standing this many frames in a row to leave the position
export const LOST_MS = 1500; // or the body is lost for this long
export const SETTLE_MS = 1000; // after entering the position, hold it this long before reps count
export const WRIST_MOVE_MAX = 0.35; // hands must stay planted: wrists may move at most this much (fraction of top height) during a rep
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

// 3D clan palace (menu backgrounds)
export const PALACE = {
  MAX_PIXEL_RATIO: 1.75, // sharper costs battery; 1.75 looks crisp on phones
  SHADOW_SIZE: 1024,
  MIN_DISTANCE: 45, // closest zoom
  MAX_DISTANCE: 210, // farthest zoom
  AUTO_ROTATE_SPEED: 0.35, // slow drift when idle
  RESUME_ROTATE_MS: 4000, // start drifting again this long after a drag
};

export const SOUND_VOLUME = 0.7; // 0 = muted, 1 = loudest
export const CLAN_DAYS = 30; // a clan membership lasts this many days (also set in supabase/clans.sql)

// "Report an issue" contacts on the Profile page
export const CONTACT_EMAIL = "huidromdiamond123@gmail.com";
export const CONTACT_WHATSAPP = "916009271012"; // country code + number, no "+" (wa.me format)

// Fast push-ups: when reps come quickly, counting switches to a quicker mode that only
// watches the shoulders (less smoothing, slightly shallower depth). It only turns on after
// a real rep was done fast, and turns off again when you slow down, so tiny wiggles never count.
export const FAST_REP_MS = 1100; // two reps closer than this = "fast"
export const FAST_HOLD_MS = 1800; // stay in fast mode until no rep for this long
export const FAST_SMOOTH_FRAMES = 2;
export const FAST_DOWN = 0.68; // fast mode: shoulders below 68% of the top height = "down"
export const FAST_UP = 0.85; // fast mode: back above 85% = rep
export const FAST_WRIST_MOVE_MAX = 0.5; // hands blur when fast, so allow a bit more wrist wobble
export const MIN_REP_MS = 280; // no rep can be faster than this (stops jitter double counts)

// Body lock (anti-cheat during battles): the body that starts the match must finish it.
// It only checks when the tracker suddenly jumps to another spot, or when someone comes back
// after the body was lost, so the same person moving around never triggers it.
export const LOCK_LEARN_FRAMES = 30; // frames used to learn the player's body proportions
export const LOCK_CHECK_FRAMES = 20; // frames compared after a jump or a return
export const LOCK_JUMP = 0.22; // the shoulders jumping this far (fraction of the picture) in one frame = tracker switched people
export const LOCK_MAX_DIFF = 0.22; // body proportions differing more than 22% = a different person
