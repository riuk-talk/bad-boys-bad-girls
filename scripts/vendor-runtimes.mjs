// Copies the cut-out runtimes from node_modules into public/vendor, so the site serves them itself
// (no CDN, CSP 'self'), loaded by the cut-out worker (public/workers/cutout-worker.js):
// - MediaPipe Tasks Vision (Apache-2.0): the bundle and its WASM, into public/vendor/mediapipe/wasm;
// - onnxruntime-web (MIT): the WASM build, one thread, into public/vendor/onnxruntime/<version>
//   (a new version gets a new address, so the files can be cached for a year).
// Run before `next build` and `next dev`; the copies are not committed (.gitignore). The models
// are (public/vendor/mediapipe/selfie_segmenter.tflite, public/vendor/modnet/v1, Apache-2.0).
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const modules = join(process.cwd(), "node_modules");

const mediapipe = join(modules, "@mediapipe", "tasks-vision");
const mediapipeTarget = join(process.cwd(), "public", "vendor", "mediapipe", "wasm");
await mkdir(mediapipeTarget, { recursive: true });
for (const file of [
  "vision_bundle.js",
  "wasm/vision_wasm_internal.js",
  "wasm/vision_wasm_internal.wasm",
  "wasm/vision_wasm_nosimd_internal.js",
  "wasm/vision_wasm_nosimd_internal.wasm",
]) {
  await copyFile(join(mediapipe, file), join(mediapipeTarget, file.replace(/^wasm\//, "")));
}
console.log(`MediaPipe WASM copied to ${mediapipeTarget}`);

const ort = join(modules, "onnxruntime-web");
const { version } = JSON.parse(await readFile(join(ort, "package.json"), "utf8"));
const ortTarget = join(process.cwd(), "public", "vendor", "onnxruntime", version);
await mkdir(ortTarget, { recursive: true });
for (const file of [
  "dist/ort.wasm.min.js",
  "dist/ort-wasm-simd-threaded.mjs",
  "dist/ort-wasm-simd-threaded.wasm",
]) {
  await copyFile(join(ort, file), join(ortTarget, file.replace(/^dist\//, "")));
}
// The npm package carries no licence file: the MIT licence of the release, kept in the repository.
await copyFile(
  join(process.cwd(), "licenses", "onnxruntime-LICENSE.txt"),
  join(ortTarget, "LICENSE"),
);
console.log(`onnxruntime-web ${version} copied to ${ortTarget}`);
