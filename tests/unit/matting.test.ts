import { describe, expect, it } from "vitest";
import {
  boxMean,
  decontaminate,
  fadeTouchingEdges,
  guidedFilter,
  refineCutout,
  resizeMatte,
} from "@/lib/image/matting";

/** A silhouette: alpha 1 where `inside(x, y)`, 0 elsewhere. */
function silhouette(width: number, height: number, inside: (x: number, y: number) => boolean) {
  const alpha = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) alpha[y * width + x] = inside(x, y) ? 1 : 0;
  return alpha;
}

describe("fadeTouchingEdges", () => {
  it("fades a side the person touches, progressively towards that border", () => {
    const width = 100;
    const height = 120;
    // A body touching the left border and the bottom, not the right one.
    const alpha = silhouette(width, height, (x, y) => x < 60 && y > 30);
    const touched = fadeTouchingEdges(alpha, width, height);
    expect(touched).toEqual({ left: true, right: false, bottom: true });
    const row = 60; // inside the body, above the bottom ramp (12 % of 120 = 14 rows)
    const values = Array.from({ length: 13 }, (_, x) => alpha[row * width + x]!);
    expect(values[0]).toBe(0);
    for (let x = 1; x < values.length; x += 1) expect(values[x]).toBeGreaterThan(values[x - 1]!);
    // Beyond 12 % of the width, untouched.
    expect(alpha[row * width + 11]).toBeLessThan(1);
    expect(alpha[row * width + 12]).toBe(1);
    expect(alpha[row * width + 40]).toBe(1);
    // The bottom fades too, down to 0 on the last row.
    const column = 40;
    expect(alpha[(height - 1) * width + column]).toBe(0);
    expect(alpha[(height - 8) * width + column]).toBeGreaterThan(0);
    expect(alpha[(height - 8) * width + column]).toBeLessThan(1);
    expect(alpha[(height - 20) * width + column]).toBe(1);
  });

  it("leaves a person who touches no border as they are", () => {
    const alpha = silhouette(80, 80, (x, y) => x > 20 && x < 60 && y > 10 && y < 70);
    const before = alpha.slice();
    expect(fadeTouchingEdges(alpha, 80, 80)).toEqual({ left: false, right: false, bottom: false });
    expect(alpha).toEqual(before);
  });

  it("ignores a stray pixel on a border", () => {
    const alpha = silhouette(100, 100, (x, y) => x === 0 && y === 50);
    expect(fadeTouchingEdges(alpha, 100, 100).left).toBe(false);
  });
});

describe("matte refinement", () => {
  it("resizes a matte bilinearly", () => {
    const out = resizeMatte([0, 1], 2, 1, 4, 1);
    expect(Array.from(out)).toEqual([0, 0.25, 0.75, 1]);
  });

  it("averages over a box, clamped at the borders", () => {
    const mean = boxMean(new Float32Array([0, 0, 3, 3]), 4, 1, 1);
    expect(Array.from(mean)).toEqual([0, 1, 2, 3]);
  });

  it("keeps a flat matte flat and snaps an edge to the edge of the picture", () => {
    const width = 40;
    const height = 1;
    // The picture changes at x = 20; the rough matte rises slowly from x = 16 to x = 28.
    const guide = new Float32Array(width).map((_, x) => (x < 20 ? 0.1 : 0.9));
    const rough = new Float32Array(width).map((_, x) => Math.min(1, Math.max(0, (x - 16) / 12)));
    const refined = guidedFilter(guide, rough, width, height, 4, 1e-4);
    expect(refined[2]).toBeCloseTo(0, 2);
    expect(refined[37]).toBeCloseTo(1, 2);
    expect(refined[18]!).toBeLessThan(rough[18]!);
    expect(refined[21]!).toBeGreaterThan(rough[21]!);
    expect(refined[20]!).toBeGreaterThan(rough[20]!);
  });

  it("takes the old background colour out of a semi-transparent edge", () => {
    // Green background, a red person, one edge pixel half red half green.
    const width = 9;
    const height = 1;
    const rgba = new Uint8ClampedArray(width * 4);
    const alpha = new Float32Array([0, 0, 0, 0, 0.5, 1, 1, 1, 1]);
    for (let x = 0; x < width; x += 1) {
      const a = alpha[x]!;
      rgba.set([Math.round(220 * a), Math.round(200 * (1 - a)), 0, 255], x * 4);
    }
    decontaminate(rgba, alpha, width, height, 4);
    expect(rgba[4 * 4]).toBeGreaterThan(200); // red recovered
    expect(rgba[4 * 4 + 1]).toBeLessThan(30); // green removed
  });

  it("writes a softened alpha into the picture", () => {
    const width = 60;
    const height = 60;
    const rgba = new Uint8ClampedArray(width * height * 4).fill(128);
    const matte = silhouette(30, 30, (x, y) => x > 8 && x < 22 && y > 5 && y < 25);
    refineCutout(rgba, width, height, matte, 30, 30);
    const at = (x: number, y: number) => rgba[(y * width + x) * 4 + 3]!;
    expect(at(30, 30)).toBe(255);
    expect(at(2, 2)).toBe(0);
    // Somewhere across the edge, intermediate values: no hard cut.
    const across = Array.from({ length: 12 }, (_, i) => at(12 + i, 30));
    expect(across.some((value) => value > 0 && value < 255)).toBe(true);
  });
});
