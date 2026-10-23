// The cut-out worker (owner's final decision 2026-10-23): MediaPipe Image Segmenter (Apache-2.0)
// with the Selfie Segmentation model (Apache-2.0), all served by the site (public/vendor). It runs
// apart from the pages, under its own Content-Security-Policy (next.config.ts: scripts and
// requests from the site only, WebAssembly allowed); the pages themselves never allow
// WebAssembly. It receives a picture and returns the person mask; the photo never leaves the
// device here.
"use strict";

const BASE = "/vendor/mediapipe";
let segmenter = null;

function load() {
  if (!segmenter) {
    segmenter = (async () => {
      self.importScripts(`${BASE}/wasm/vision_bundle.js`);
      const { FilesetResolver, ImageSegmenter } = self.Vision;
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      return ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}/selfie_segmenter.tflite`, delegate: "CPU" },
        runningMode: "IMAGE",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    })();
    // A failed load may be retried with the next photo.
    segmenter.catch(() => {
      segmenter = null;
    });
  }
  return segmenter;
}

self.onmessage = async (event) => {
  const { id, type, bitmap } = event.data;
  try {
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
