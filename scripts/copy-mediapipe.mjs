// Copies MediaPipe's WASM files from node_modules into public/ so the app serves them itself
// (no third-party CDN can change the code that runs next to the camera). Runs before dev and build.
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/mediapipe/wasm", { recursive: true });
cpSync("node_modules/@mediapipe/tasks-vision/wasm", "public/mediapipe/wasm", { recursive: true });
console.log("MediaPipe WASM copied to public/mediapipe/wasm");
