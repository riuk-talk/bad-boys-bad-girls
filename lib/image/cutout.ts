/**
 * In-browser cut-out of the member's photo (owner's final decision 2026-10-23; engine of 9i):
 * MODNet portrait matting (Apache-2.0) run by onnxruntime-web (MIT) in the worker
 * (public/workers/cutout-worker.js), under its own policy allowing WebAssembly. When MODNet
 * cannot (time, memory, an old device), the fallback is the previous engine: MediaPipe Image
 * Segmenter with the Selfie Segmentation model (Apache-2.0), in the worker, or in the page where
 * the worker cannot run it (WebKit). Everything is served by the site itself (public/vendor), and
 * downloaded on the photo steps only. Then the same edge treatment for both (lib/image/matting).
 * The photo never leaves the device for this; only the result is sent, to the Greffe, which
 * validates it (never automatically).
 */
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import {
  CUTOUT_LOAD_BUDGET_MS,
  CUTOUT_RUN_BUDGET_MS,
  decideCutout,
  maskAlpha,
  personShare,
  type CutoutDecision,
} from "./cutout-policy";
import { refineCutout } from "./matting";

const WORKER_PATH = "/workers/cutout-worker.js";
const WASM_PATH = "/vendor/mediapipe/wasm";
const MODEL_PATH = "/vendor/mediapipe/selfie_segmenter.tflite";
/** The server keeps 1200 px at most (lib/image/process.ts): no need to send more. */
const MAX_SIDE = 1200;
/** Under the server's limit for an upload (2 MB). */
const MAX_BYTES = 1_900_000;

type Mask = { mask: Float32Array; width: number; height: number };
type Reply = { id: number; ok: boolean; error?: string; webgl?: boolean } & Partial<Mask>;

let worker: Worker | null = null;
let lastId = 0;
const waiting = new Map<
  number,
  { resolve: (reply: Reply) => void; reject: (error: Error) => void }
>();

function stopWorker(reason: string) {
  worker?.terminate();
  worker = null;
  for (const pending of waiting.values()) pending.reject(new Error(reason));
  waiting.clear();
}

function ask(
  message:
    | { type: "caps" }
    | { type: "load" }
    | { type: "modnet-load" }
    | { type: "segment"; bitmap: ImageBitmap }
    | { type: "modnet"; bitmap: ImageBitmap },
): Promise<Reply> {
  if (!worker) {
    worker = new Worker(WORKER_PATH);
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const pending = waiting.get(event.data.id);
      waiting.delete(event.data.id);
      if (!pending) return;
      if (event.data.ok) pending.resolve(event.data);
      else pending.reject(new Error(event.data.error ?? "worker"));
    };
    worker.onerror = (event) => stopWorker(`worker failed: ${event.message || "no message"}`);
  }
  lastId += 1;
  const id = lastId;
  const target = worker;
  return new Promise<Reply>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    if (message.type === "segment" || message.type === "modnet")
      target.postMessage({ id, ...message }, [message.bitmap]);
    else target.postMessage({ id, ...message });
  });
}

/**
 * MODNet in the worker: started on the photo steps (preloadCutout), given up for the session
 * after a failure or a photo over the time budget (the device is too slow for it).
 */
let modnet: Promise<void> | null = null;
let modnetFailure: string | null = null;

function preloadModnet(): Promise<void> {
  if (modnetFailure) return Promise.reject(new Error(modnetFailure));
  if (!modnet) {
    modnet = ask({ type: "modnet-load" }).then(() => undefined);
    modnet.catch((error: unknown) => {
      modnetFailure = error instanceof Error ? error.message : String(error);
      modnet = null;
    });
  }
  return modnet;
}

async function modnetMatte(canvas: HTMLCanvasElement): Promise<Mask | null> {
  const reply = await within(
    ask({ type: "modnet", bitmap: await createImageBitmap(canvas) }),
    CUTOUT_RUN_BUDGET_MS,
  );
  if (!reply) {
    modnetFailure = "too slow";
    stopWorker("too slow");
    return null;
  }
  if (!reply.mask || !reply.width || !reply.height) throw new Error("no matte");
  return { mask: reply.mask, width: reply.width, height: reply.height };
}

/** Where the MediaPipe segmentation runs: the worker, or the page when the worker cannot. */
type Engine = {
  name: "worker" | "page";
  segment: (canvas: HTMLCanvasElement) => Promise<Mask | null>;
};

const workerEngine: Engine = {
  name: "worker",
  async segment(canvas) {
    const reply = await within(
      ask({ type: "segment", bitmap: await createImageBitmap(canvas) }),
      CUTOUT_RUN_BUDGET_MS,
    );
    if (!reply) {
      // Too slow: the worker is stopped, it will be started again for the next photo.
      stopWorker("too slow");
      return null;
    }
    if (!reply.mask || !reply.width || !reply.height) throw new Error("no mask");
    return { mask: reply.mask, width: reply.width, height: reply.height };
  },
};

function pageEngine(segmenter: ImageSegmenter): Engine {
  return {
    name: "page",
    async segment(canvas) {
      const result = segmenter.segment(canvas);
      const mask = result.confidenceMasks?.[0];
      if (!mask) throw new Error("no mask");
      const values = mask.getAsFloat32Array().slice();
      const { width, height } = mask;
      result.close();
      return { mask: values, width, height };
    },
  };
}

async function loadInPage(): Promise<Engine> {
  const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
    runningMode: "IMAGE",
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
  return pageEngine(segmenter);
}

/** The smallest valid module: compiling it tells whether the page's policy allows WebAssembly. */
const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function wasmAllowedInPage(): boolean {
  try {
    new WebAssembly.Module(EMPTY_MODULE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the cut-out can run, found at once, before any download: the worker when it has a WebGL
 * context, otherwise the page when its policy allows WebAssembly (the photo pages, loaded
 * directly), otherwise nowhere ("none": a photo page reached by a link keeps the policy of the
 * page before it; usePreloadCutout then loads it again).
 */
export type EngineChoice = "worker" | "page" | "none";
let choice: Promise<EngineChoice> | null = null;

export function chooseEngine(): Promise<EngineChoice> {
  if (!choice) {
    choice = (async () => {
      if (!supported()) return "none";
      const caps = await within(
        ask({ type: "caps" }).catch(() => null),
        3_000,
      );
      if (caps?.webgl) return "worker";
      workerFailure = caps ? "no WebGL context in the worker" : "worker did not start";
      stopWorker("not used");
      return wasmAllowedInPage() ? "page" : "none";
    })();
  }
  return choice;
}

let engine: Promise<Engine> | null = null;
/** Why the worker could not be used, if it could not (shown to the tests, never to members). */
let workerFailure: string | null = null;

/**
 * Starts loading MODNet (the photo steps call it on arrival); shared afterwards. MediaPipe, the
 * fallback, is only loaded when MODNet fails.
 */
export function preloadCutout(): Promise<void> {
  return preloadModnet().catch(() => undefined);
}

function preloadMediapipe(): Promise<Engine> {
  if (!engine) {
    engine = chooseEngine().then((where) => {
      if (where === "page") return loadInPage();
      if (where === "none") throw new Error("WebAssembly not allowed here");
      return ask({ type: "load" })
        .then(() => workerEngine)
        .catch((error: unknown) => {
          workerFailure = error instanceof Error ? error.message : String(error);
          stopWorker("load failed");
          if (!wasmAllowedInPage()) throw error;
          return loadInPage();
        });
    });
    // A failed load may be retried with the next photo.
    engine.catch(() => {
      engine = null;
    });
  }
  return engine;
}

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms + 1)),
  ]);
}

export type CutoutResult = {
  decision: CutoutDecision;
  /** The cut-out (WebP with transparency, PNG where the browser cannot encode WebP). */
  blob: Blob | null;
  elapsedMs: number;
  /** Where it ran, and why not in the worker (diagnostics for the tests). */
  detail?: string;
};

function supported(): boolean {
  return (
    typeof WebAssembly === "object" &&
    typeof Worker === "function" &&
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
 * whether the result may be offered; otherwise the original goes to the Greffe for its cut-out.
 */
export async function cutOut(photo: Blob): Promise<CutoutResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let detail: string | undefined;
  if (!supported()) {
    return { decision: decideCutout({ supported: false }), blob: null, elapsedMs: 0 };
  }
  try {
    const bitmap = await createImageBitmap(photo);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const { width: w, height: h } = canvas;
    const image = context.getImageData(0, 0, w, h);
    // A picture already cut out (the Greffe's batch on the preview): seen by the model on a
    // neutral grey, and never more opaque afterwards than it was.
    const previousAlpha = flattenTransparency(image.data);
    if (previousAlpha) context.putImageData(image, 0, 0);

    let matte: Mask | null = null;
    let loadMs = 0;
    let runMs = 0;
    // 1. MODNet, in the worker.
    const modnetStarted = performance.now();
    const ready = await within(
      preloadModnet().then(
        () => true,
        () => false,
      ),
      CUTOUT_LOAD_BUDGET_MS,
    );
    loadMs = Math.round(performance.now() - modnetStarted);
    if (ready) {
      const runStarted = performance.now();
      matte = await modnetMatte(canvas).catch((error: unknown) => {
        modnetFailure = error instanceof Error ? error.message : String(error);
        return null;
      });
      runMs = Math.round(performance.now() - runStarted);
      if (matte) detail = "modnet";
    } else if (!modnetFailure) {
      modnetFailure = "too slow to load";
    }

    // 2. The fallback: MediaPipe (worker, or page), with its own budgets.
    if (!matte) {
      const fallbackStarted = performance.now();
      const engineReady = await within(preloadMediapipe(), CUTOUT_LOAD_BUDGET_MS);
      loadMs = Math.round(performance.now() - fallbackStarted);
      if (!engineReady) {
        return {
          decision: decideCutout({ supported: true, loadMs }),
          blob: null,
          elapsedMs: elapsed(),
          detail: `mediapipe load (modnet: ${modnetFailure})`,
        };
      }
      const failures = () =>
        [`modnet: ${modnetFailure}`, workerFailure ? `worker: ${workerFailure}` : null]
          .filter(Boolean)
          .join("; ");
      detail = `${engineReady.name} (${failures()})`;
      const runStarted = performance.now();
      const segmented = await engineReady.segment(canvas).catch(async (error: unknown) => {
        if (engineReady.name !== "worker" || !wasmAllowedInPage()) throw error;
        // The worker loaded but could not compute: from now on, the page cuts out itself.
        workerFailure = error instanceof Error ? error.message : String(error);
        stopWorker("compute failed");
        engine = loadInPage();
        engine.catch(() => {
          engine = null;
        });
        const page = await within(engine, Math.max(0, CUTOUT_LOAD_BUDGET_MS - loadMs));
        if (!page) throw new Error("page engine too slow to load");
        detail = `page (${failures()})`;
        return page.segment(canvas);
      });
      runMs = Math.round(performance.now() - runStarted);
      if (!segmented) {
        return {
          decision: decideCutout({ supported: true, loadMs, runMs }),
          blob: null,
          elapsedMs: elapsed(),
          detail,
        };
      }
      // The person confidence, as an alpha matte (the same soft edge as before).
      const alpha = new Float32Array(segmented.mask.length);
      for (let i = 0; i < alpha.length; i += 1) alpha[i] = maskAlpha(segmented.mask[i] ?? 0) / 255;
      matte = { mask: alpha, width: segmented.width, height: segmented.height };
    }

    const refineStarted = performance.now();
    const share = personShare(matte.mask);
    const early = decideCutout({ supported: true, loadMs, runMs, personShare: share });
    if (early.kind !== "cutout")
      return { decision: early, blob: null, elapsedMs: elapsed(), detail };
    refineCutout(image.data, w, h, matte.mask, matte.width, matte.height);
    if (previousAlpha) {
      for (let i = 0; i < w * h; i += 1)
        image.data[i * 4 + 3] = Math.min(image.data[i * 4 + 3] ?? 0, previousAlpha[i] ?? 0);
    }
    context.putImageData(image, 0, 0);
    // The edge treatment counts in the computing budget.
    runMs += Math.round(performance.now() - refineStarted);
    const decision = decideCutout({ supported: true, loadMs, runMs, personShare: share });
    if (decision.kind !== "cutout") return { decision, blob: null, elapsedMs: elapsed(), detail };
    const blob = await encodeCutout(canvas);
    if (!blob) {
      return {
        decision: decideCutout({ supported: true, failed: true }),
        blob: null,
        elapsedMs: elapsed(),
        detail,
      };
    }
    return { decision, blob, elapsedMs: elapsed(), detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      decision: decideCutout({ supported: true, failed: true }),
      blob: null,
      elapsedMs: elapsed(),
      detail: `${detail ?? (workerFailure ? `worker: ${workerFailure}` : "load")}; ${message}`,
    };
  }
}

/**
 * When the picture has transparency (already cut out), lays it on a neutral grey in place and
 * returns its former alpha; null for an opaque picture.
 */
function flattenTransparency(rgba: Uint8ClampedArray): Uint8ClampedArray | null {
  let transparent = false;
  for (let i = 3; i < rgba.length; i += 4) {
    if ((rgba[i] ?? 255) < 250) {
      transparent = true;
      break;
    }
  }
  if (!transparent) return null;
  const alpha = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0; i < alpha.length; i += 1) {
    const a = (rgba[i * 4 + 3] ?? 255) / 255;
    alpha[i] = rgba[i * 4 + 3] ?? 255;
    for (let c = 0; c < 3; c += 1) rgba[i * 4 + c] = (rgba[i * 4 + c] ?? 0) * a + 128 * (1 - a);
    rgba[i * 4 + 3] = 255;
  }
  return alpha;
}
