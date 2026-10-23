import { describe, expect, it } from "vitest";
import {
  CUTOUT_LOAD_BUDGET_MS,
  CUTOUT_RUN_BUDGET_MS,
  decideCutout,
  maskAlpha,
  personShare,
} from "@/lib/image/cutout-policy";

describe("decideCutout: when the original goes to the Greffe for its cut-out", () => {
  const ok = { supported: true, loadMs: 300, runMs: 1_300, personShare: 0.4 };

  it("uses the cut-out when everything went well", () => {
    expect(decideCutout(ok)).toEqual({ kind: "cutout" });
  });

  it("no WebAssembly or an old browser: to the Greffe", () => {
    expect(decideCutout({ ...ok, supported: false })).toEqual({
      kind: "as_is",
      reason: "unsupported",
    });
  });

  it("a failure while loading or segmenting: to the Greffe", () => {
    expect(decideCutout({ ...ok, failed: true })).toEqual({ kind: "as_is", reason: "error" });
  });

  it("a phone too slow to compute: to the Greffe", () => {
    expect(decideCutout({ ...ok, runMs: CUTOUT_RUN_BUDGET_MS })).toEqual({ kind: "cutout" });
    expect(decideCutout({ ...ok, runMs: CUTOUT_RUN_BUDGET_MS + 1 })).toEqual({
      kind: "as_is",
      reason: "too_slow",
    });
    expect(decideCutout({ ...ok, runMs: undefined })).toEqual({
      kind: "as_is",
      reason: "too_slow",
    });
  });

  it("a runtime too long to load (slow network): to the Greffe", () => {
    expect(decideCutout({ ...ok, loadMs: CUTOUT_LOAD_BUDGET_MS })).toEqual({ kind: "cutout" });
    expect(decideCutout({ ...ok, loadMs: CUTOUT_LOAD_BUDGET_MS + 1 })).toEqual({
      kind: "as_is",
      reason: "too_slow",
    });
    expect(decideCutout({ ...ok, loadMs: undefined }).kind).toBe("as_is");
  });

  it("the budgets keep a wide margin over the measured low-end phone (1.3 s, 16.6 s)", () => {
    expect(CUTOUT_RUN_BUDGET_MS).toBeGreaterThanOrEqual(3 * 1_300);
    expect(CUTOUT_LOAD_BUDGET_MS).toBeGreaterThan(16_600);
  });

  it("no one found, or no background left: to the Greffe", () => {
    expect(decideCutout({ ...ok, personShare: 0.02 })).toEqual({
      kind: "as_is",
      reason: "no_person",
    });
    expect(decideCutout({ ...ok, personShare: 0.97 })).toEqual({
      kind: "as_is",
      reason: "no_person",
    });
    expect(decideCutout({ ...ok, personShare: undefined }).kind).toBe("as_is");
  });
});

describe("mask helpers", () => {
  it("a soft edge between 0.35 and 0.65", () => {
    expect(maskAlpha(0)).toBe(0);
    expect(maskAlpha(0.35)).toBe(0);
    expect(maskAlpha(0.5)).toBe(128);
    expect(maskAlpha(0.65)).toBe(255);
    expect(maskAlpha(1)).toBe(255);
    expect(maskAlpha(0.45)).toBeLessThan(maskAlpha(0.55));
  });

  it("the share of the person in a mask", () => {
    expect(personShare([])).toBe(0);
    expect(personShare([0.9, 0.1, 0.6, 0.2])).toBe(0.5);
    expect(personShare(new Float32Array([0.99, 0.99]))).toBe(1);
  });
});
