import { describe, expect, it } from "vitest";
import { tiltOf } from "@/lib/relations/dossier";

describe("tiltOf", () => {
  it("gives the same tilt to the same profile, between -3 and 3 degrees", () => {
    const id = "3eb15c94-47e8-474b-841f-25d0d3ab1189";
    expect(tiltOf(id)).toBe(tiltOf(id));
    const tilts = Array.from({ length: 200 }, (_, i) => tiltOf(`profile-${i}`));
    expect(Math.min(...tilts)).toBe(-3);
    expect(Math.max(...tilts)).toBe(3);
  });
});
