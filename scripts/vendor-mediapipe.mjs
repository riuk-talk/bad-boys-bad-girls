// Copies the MediaPipe Tasks Vision runtime (Apache-2.0) from node_modules into
// public/vendor/mediapipe/wasm, so the site serves it itself (no CDN, CSP 'self'): the bundle
// loaded by the cut-out worker (public/workers/cutout-worker.js) and its WASM. Run before
// `next build` and `next dev`; the copies are not committed (.gitignore), the model
// (public/vendor/mediapipe/selfie_segmenter.tflite, Apache-2.0) is.
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const pkg = join(process.cwd(), "node_modules", "@mediapipe", "tasks-vision");
const target = join(process.cwd(), "public", "vendor", "mediapipe", "wasm");
const FILES = [
  "vision_bundle.js",
  "wasm/vision_wasm_internal.js",
  "wasm/vision_wasm_internal.wasm",
  "wasm/vision_wasm_nosimd_internal.js",
  "wasm/vision_wasm_nosimd_internal.wasm",
];

await mkdir(target, { recursive: true });
for (const file of FILES) {
  await copyFile(join(pkg, file), join(target, file.replace(/^wasm\//, "")));
}
console.log(`MediaPipe WASM copied to ${target}`);
