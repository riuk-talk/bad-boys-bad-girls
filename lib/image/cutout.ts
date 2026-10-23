/**
 * In-browser cut-out of the member's photo (owner's final decision 2026-10-23): MediaPipe Image
 * Segmenter (Apache-2.0) with the Selfie Segmentation model (Apache-2.0), both served by the site
 * itself (public/vendor/mediapipe). The segmentation runs in a worker
 * (public/workers/cutout-worker.js) under its own policy allowing WebAssembly; where the worker
 * cannot run it (WebKit, measured in CI), it runs in the page, which the photo pages allow
 * (lib/security/csp). The photo never leaves the device for this; only the result is sent.
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
  message: { type: "caps" } | { type: "load" } | { type: "segment"; bitmap: ImageBitmap },
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
    if (message.type === "segment") target.postMessage({ id, ...message }, [message.bitmap]);
    else target.postMessage({ id, ...message });
  });
}

/** Where the segmentation runs: the worker, or the page when the worker cannot run it. */
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

/** Starts loading the runtime and the model (the step calls it on arrival); shared afterwards. */
export function preloadCutout(): Promise<Engine> {
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
    // Past the loading budget, give up waiting (the original goes to the Greffe).
    const ready = await within(preloadCutout(), CUTOUT_LOAD_BUDGET_MS);
    const loadMs = elapsed();
    if (!ready) {
      return { decision: decideCutout({ supported: true, loadMs }), blob: null, elapsedMs: loadMs };
    }
    detail = workerFailure ? `${ready.name} (worker: ${workerFailure})` : ready.name;
    const runStarted = performance.now();
    const runMs = () => Math.round(performance.now() - runStarted);

    const bitmap = await createImageBitmap(photo);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const segmented = await ready.segment(canvas).catch(async (error: unknown) => {
      if (ready.name !== "worker" || !wasmAllowedInPage()) throw error;
      // The worker loaded but could not compute: from now on, the page cuts out itself.
      workerFailure = error instanceof Error ? error.message : String(error);
      stopWorker("compute failed");
      engine = loadInPage();
      engine.catch(() => {
        engine = null;
      });
      const page = await within(engine, Math.max(0, CUTOUT_LOAD_BUDGET_MS - loadMs));
      if (!page) throw new Error("page engine too slow to load");
      detail = `page (worker: ${workerFailure})`;
      return page.segment(canvas);
    });
    if (!segmented) {
      return {
        decision: decideCutout({ supported: true, loadMs, runMs: runMs() }),
        blob: null,
        elapsedMs: elapsed(),
        detail,
      };
    }
    const { mask: values, width, height } = segmented;
    const share = personShare(values);
    // The mask, as an alpha layer at its own size, then stretched (smoothly) on the photo.
    const layer = document.createElement("canvas");
    layer.width = width;
    layer.height = height;
    const layerContext = layer.getContext("2d");
    if (!layerContext) throw new Error("no 2d context");
    const pixels = layerContext.createImageData(width, height);
    for (let i = 0; i < values.length; i += 1) pixels.data[i * 4 + 3] = maskAlpha(values[i] ?? 0);
    layerContext.putImageData(pixels, 0, 0);

    const decision = decideCutout({
      supported: true,
      loadMs,
      runMs: runMs(),
      personShare: share,
    });
    if (decision.kind !== "cutout") return { decision, blob: null, elapsedMs: elapsed(), detail };

    context.globalCompositeOperation = "destination-in";
    context.imageSmoothingQuality = "high";
    context.drawImage(layer, 0, 0, canvas.width, canvas.height);
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
