import { describe, expect, it } from "vitest";
import { completeness } from "@/lib/fiche/completeness";

describe("completeness", () => {
  it("is 0 % for a bare Fiche and lists what is missing", () => {
    expect(
      completeness({ mainPhoto: "pending", photoCount: 1, bioLength: 0, signCount: 0 }),
    ).toEqual({
      percent: 0,
      missing: ["mainPhoto", "bio", "signs", "morePhotos"],
    });
  });

  it("counts an approved main photo, a real bio, signs and three photos", () => {
    expect(
      completeness({ mainPhoto: "approved", photoCount: 3, bioLength: 120, signCount: 2 }).percent,
    ).toBe(100);
    expect(
      completeness({ mainPhoto: "approved", photoCount: 1, bioLength: 10, signCount: 1 }).percent,
    ).toBe(60);
  });
});
