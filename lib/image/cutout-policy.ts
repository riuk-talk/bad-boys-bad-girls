/**
 * In-browser cut-out of a photo (owner's decision 2026-10-23, version B): when the result may be
 * used, and when the photo stays as it is (version A, the graduations drawn over it). Pure rules,
 * shared by lib/image/cutout.ts and the tests.
 */

/**
 * Time budgets (measured on a low-end phone simulated, Chromium CPU 6× slower and « slow 4G »:
 * 1.3 s of computing, 16.6 s to download the runtime cold; docs/PROGRESS.md, Phase 9e).
 * - computing (segmenting and cutting): beyond it the phone is too slow;
 * - loading the runtime and the model, when the step had not finished preloading them.
 * Past either one, the photo stays as it is. The member may also stop waiting at any time.
 */
export const CUTOUT_RUN_BUDGET_MS = 5_000;
export const CUTOUT_LOAD_BUDGET_MS = 20_000;

/** Share of the picture the person must cover: below, no one was found; above, no background. */
export const MIN_PERSON_SHARE = 0.08;
export const MAX_PERSON_SHARE = 0.92;

/** Confidence (0–1) where the edge of the person is drawn: soft between the two. */
const EDGE_FROM = 0.35;
const EDGE_TO = 0.65;

export type FallbackReason = "unsupported" | "error" | "too_slow" | "no_person" | "refused";

export type CutoutDecision = { kind: "cutout" } | { kind: "as_is"; reason: FallbackReason };

/**
 * What to do with a cut-out attempt. Any doubt keeps the photo as it is: the member's photo is
 * never lost, only its background.
 */
export function decideCutout(attempt: {
  supported: boolean;
  failed?: boolean;
  loadMs?: number;
  runMs?: number;
  personShare?: number;
  refused?: boolean;
}): CutoutDecision {
  if (!attempt.supported) return { kind: "as_is", reason: "unsupported" };
  if (attempt.failed) return { kind: "as_is", reason: "error" };
  if (
    (attempt.loadMs ?? Infinity) > CUTOUT_LOAD_BUDGET_MS ||
    (attempt.runMs ?? Infinity) > CUTOUT_RUN_BUDGET_MS
  ) {
    return { kind: "as_is", reason: "too_slow" };
  }
  const share = attempt.personShare ?? 0;
  if (share < MIN_PERSON_SHARE || share > MAX_PERSON_SHARE) {
    return { kind: "as_is", reason: "no_person" };
  }
  if (attempt.refused) return { kind: "as_is", reason: "refused" };
  return { kind: "cutout" };
}

/** Alpha (0–255) of a pixel from the person confidence: a soft, smooth edge (smoothstep). */
export function maskAlpha(confidence: number): number {
  const t = Math.min(1, Math.max(0, (confidence - EDGE_FROM) / (EDGE_TO - EDGE_FROM)));
  return Math.round(t * t * (3 - 2 * t) * 255);
}

/** Share of a confidence mask where the person is more likely than the background. */
export function personShare(mask: ArrayLike<number>): number {
  if (mask.length === 0) return 0;
  let person = 0;
  for (let i = 0; i < mask.length; i += 1) if ((mask[i] ?? 0) > 0.5) person += 1;
  return person / mask.length;
}
