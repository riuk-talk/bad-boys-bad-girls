/**
 * In-browser cut-out of the member's photo (owner's decision 2026-10-23, version B): MediaPipe
 * Image Segmenter (Apache-2.0) with the Selfie Segmentation model (Apache-2.0), both served by the
 * site itself (public/vendor/mediapipe). The photo never leaves the device for this; only the
 * result the member chooses is sent. Loaded with a dynamic import on the photo steps only.
 */
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import {
  CUTOUT_LOAD_BUDGET_MS,
  decideCutout,
  maskAlpha,
  personShare,
  type CutoutDecision,
} from "./cutout-policy";

const WASM_PATH = "/vendor/mediapipe/wasm";
const MODEL_PATH = "/vendor/mediapipe/selfie_segmenter.tflite";
/** The server keeps 1200 px at most (lib/image/process.ts): no need to send more. */
const MAX_SIDE = 1200;
/** Under the server's limit for an upload (2 MB). */
const MAX_BYTES = 1_900_000;

let segmenter: Promise<ImageSegmenter> | null = null;

/** Starts loading the runtime and the model (the step calls it on arrival); shared afterwards. */
export function preloadCutout(): Promise<ImageSegmenter> {
  if (!segmenter) {
    segmenter = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      return ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
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

export type CutoutResult = {
  decision: CutoutDecision;
  /** The cut-out (WebP with transparency, PNG where the browser cannot encode WebP). */
  blob: Blob | null;
  elapsedMs: number;
};

function supported(): boolean {
  return (
    typeof WebAssembly === "object" &&
    typeof createImageBitmap === "function" &&
    typeof document !== "undefined"
  );
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Transparent where the mask says background; WebP if the browser encodes it, PNG otherwise. */
async function encodeCutout(canvas: HTMLCanvasElement): Promise<Blob | null> {
  for (const quality of [0.9, 0.8, 0.7]) {
    const webp = await toBlob(canvas, "image/webp", quality);
    if (webp && webp.type === "image/webp" && webp.size <= MAX_BYTES) return webp;
    if (webp && webp.type !== "image/webp") break;
  }
  const png = await toBlob(canvas, "image/png");
  return png && png.size <= MAX_BYTES ? png : null;
}

/**
 * Cuts the person out of `photo`. Two budgets (lib/image/cutout-policy.ts): the loading of the
 * runtime when the step had not finished preloading it, then the computing. The decision says
 * whether the result may be offered; anything else keeps the photo as it is.
 */
export async function cutOut(photo: Blob): Promise<CutoutResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  if (!supported()) {
    return { decision: decideCutout({ supported: false }), blob: null, elapsedMs: 0 };
  }
  try {
    // Past the loading budget, give up waiting (the photo stays as it is).
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), CUTOUT_LOAD_BUDGET_MS + 1),
    );
    const model = await Promise.race([preloadCutout(), timeout]);
    const loadMs = elapsed();
    if (!model) {
      return { decision: decideCutout({ supported: true, loadMs }), blob: null, elapsedMs: loadMs };
    }
    const runStarted = performance.now();

    const bitmap = await createImageBitmap(photo);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const result = model.segment(canvas);
    const mask = result.confidenceMasks?.[0];
    if (!mask) throw new Error("no mask");
    const values = mask.getAsFloat32Array();
    const share = personShare(values);
    // The mask, as an alpha layer at its own size, then stretched (smoothly) on the photo.
    const layer = document.createElement("canvas");
    layer.width = mask.width;
    layer.height = mask.height;
    const layerContext = layer.getContext("2d");
    if (!layerContext) throw new Error("no 2d context");
    const pixels = layerContext.createImageData(mask.width, mask.height);
    for (let i = 0; i < values.length; i += 1) pixels.data[i * 4 + 3] = maskAlpha(values[i] ?? 0);
    layerContext.putImageData(pixels, 0, 0);
    result.close();

    const decision = decideCutout({
      supported: true,
      loadMs,
      runMs: Math.round(performance.now() - runStarted),
      personShare: share,
    });
    if (decision.kind !== "cutout") return { decision, blob: null, elapsedMs: elapsed() };

    context.globalCompositeOperation = "destination-in";
    context.imageSmoothingQuality = "high";
    context.drawImage(layer, 0, 0, canvas.width, canvas.height);
    const blob = await encodeCutout(canvas);
    if (!blob) {
      return {
        decision: decideCutout({ supported: true, failed: true }),
        blob: null,
        elapsedMs: elapsed(),
      };
    }
    return { decision, blob, elapsedMs: elapsed() };
  } catch {
    return {
      decision: decideCutout({ supported: true, failed: true }),
      blob: null,
      elapsedMs: elapsed(),
    };
  }
}
