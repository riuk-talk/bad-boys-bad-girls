// The cut-out worker. Two engines, all served by the site (public/vendor), never by a third party:
// - MODNet (portrait matting, Apache-2.0; ONNX fp16 conversion, Apache-2.0) run by
//   onnxruntime-web (MIT) on WebAssembly, CPU, one thread: the matte, hair included (9i);
// - MediaPipe Image Segmenter with the Selfie Segmentation model (Apache-2.0): the fallback when
//   MODNet cannot run (time, memory, an old device).
// It runs apart from the pages, under its own Content-Security-Policy (next.config.ts: scripts and
// requests from the site only, WebAssembly allowed); the pages themselves never allow WebAssembly
// (except the photo pages, for the MediaPipe fallback in the page). It receives a picture and
// returns the matte or the person mask; the photo never leaves the device here.
"use strict";

const BASE = "/vendor/mediapipe";
// Copied from node_modules/onnxruntime-web at build time (scripts/vendor-runtimes.mjs), under its
// version: the files never change at a given address (cached for a year, next.config.ts).
const ORT = "/vendor/onnxruntime/1.30.0";
const MODNET = "/vendor/modnet/v1/modnet-fp16.onnx";
/** MODNet works on sizes divisible by 32; 512 on the long side keeps phones within budget. */
const MODNET_LONG_SIDE = 512;
let segmenter = null;
let modnet = null;

function load() {
  if (!segmenter) {
    segmenter = (async () => {
      self.importScripts(`${BASE}/wasm/vision_bundle.js`);
      const { FilesetResolver, ImageSegmenter } = self.Vision;
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const model = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}/selfie_segmenter.tflite`, delegate: "CPU" },
        runningMode: "IMAGE",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
      // A first segmentation on a small blank picture: some browsers load the model in a worker
      // but cannot compute there (WebKit: no WebGL context in workers). The load then fails, and
      // the page cuts out itself (lib/image/cutout.ts).
      model.segment(new ImageData(32, 32)).close();
      return model;
    })();
    // A failed load may be retried with the next photo.
    segmenter.catch(() => {
      segmenter = null;
    });
  }
  return segmenter;
}

function loadModnet() {
  if (!modnet) {
    modnet = (async () => {
      self.importScripts(`${ORT}/ort.wasm.min.js`);
      const ort = self.ort;
      ort.env.wasm.wasmPaths = `${ORT}/`;
      // One thread: several need SharedArrayBuffer (cross-origin isolation), not enabled here.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      const session = await ort.InferenceSession.create(MODNET, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      return { ort, session };
    })();
    modnet.catch(() => {
      modnet = null;
    });
  }
  return modnet;
}

/** The alpha matte (0–1) of the person in `bitmap`, at the model's size. */
async function matte(bitmap) {
  const { ort, session } = await loadModnet();
  const scale = MODNET_LONG_SIDE / Math.max(bitmap.width, bitmap.height);
  const width = Math.max(32, Math.round((bitmap.width * scale) / 32) * 32);
  const height = Math.max(32, Math.round((bitmap.height * scale) / 32) * 32);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context in the worker");
  context.drawImage(bitmap, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const size = width * height;
  // RGB in planes, normalised to −1…1 (mean 0.5, std 0.5).
  const input = new Float32Array(3 * size);
  for (let i = 0; i < size; i += 1) {
    input[i] = data[i * 4] / 127.5 - 1;
    input[size + i] = data[i * 4 + 1] / 127.5 - 1;
    input[2 * size + i] = data[i * 4 + 2] / 127.5 - 1;
  }
  const outputs = await session.run({
    [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, height, width]),
  });
  const result = outputs[session.outputNames[0]];
  const values = new Float32Array(result.data);
  return { mask: values, width: result.dims[3], height: result.dims[2] };
}

self.onmessage = async (event) => {
  const { id, type, bitmap } = event.data;
  if (type === "caps") {
    // Whether this worker can compute with MediaPipe (it needs a WebGL context): answered at
    // once, before any download.
    let webgl = false;
    try {
      const canvas = new OffscreenCanvas(1, 1);
      webgl = Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      webgl = false;
    }
    self.postMessage({ id, ok: true, webgl });
    return;
  }
  try {
    if (type === "modnet-load") {
      await loadModnet();
      self.postMessage({ id, ok: true });
      return;
    }
    if (type === "modnet") {
      const result = await matte(bitmap);
      bitmap.close();
      self.postMessage({ id, ok: true, ...result }, [result.mask.buffer]);
      return;
    }
    const model = await load();
    if (type === "load") {
      self.postMessage({ id, ok: true });
      return;
    }
    const result = model.segment(bitmap);
    bitmap.close();
    const mask = result.confidenceMasks && result.confidenceMasks[0];
    if (!mask) throw new Error("no mask");
    const values = mask.getAsFloat32Array().slice();
    const { width, height } = mask;
    result.close();
    self.postMessage({ id, ok: true, mask: values, width, height }, [values.buffer]);
  } catch (error) {
    if (bitmap) bitmap.close();
    self.postMessage({ id, ok: false, error: String(error) });
  }
};
