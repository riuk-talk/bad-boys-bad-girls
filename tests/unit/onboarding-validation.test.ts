import { describe, expect, it } from "vitest";
import {
  ageOn,
  ageStepSchema,
  firstErrors,
  identityStepSchema,
  seekingStepSchema,
} from "@/lib/validation/onboarding";

const iso = (d: Date) => d.toISOString().slice(0, 10);
function yearsAgo(years: number, days = 0) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}
const accepted = { attest: "on", terms: "on", privacy: "on" };

describe("age step", () => {
  it("accepts exactly 18 today and refuses 18 minus one day", () => {
    expect(ageStepSchema.safeParse({ birthdate: yearsAgo(18), ...accepted }).success).toBe(true);
    const minor = ageStepSchema.safeParse({ birthdate: yearsAgo(18, 1), ...accepted });
    expect(minor.success).toBe(false);
    if (!minor.success) expect(firstErrors(minor.error).birthdate).toBe("underage");
  });

  it("rejects impossible dates and unchecked boxes", () => {
    const result = ageStepSchema.safeParse({ birthdate: "2001-02-30" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstErrors(result.error)).toEqual({
        birthdate: "invalidDate",
        attest: "mustAccept",
        terms: "mustAccept",
        privacy: "mustAccept",
      });
    }
  });

  it("computes age like Postgres age()", () => {
    expect(ageOn("2000-03-15", new Date("2026-03-14T12:00:00Z"))).toBe(25);
    expect(ageOn("2000-03-15", new Date("2026-03-15T12:00:00Z"))).toBe(26);
  });
});

describe("identity step", () => {
  it("accepts accented pseudos and refuses contacts or symbols", () => {
    expect(identityStepSchema.safeParse({ pseudo: " Rebelle Élodie ", gender: "woman", placeId: "12" }).success).toBe(true);
    for (const pseudo of ["ab", "a@b.fr", "x".repeat(21), "<script>"]) {
      expect(identityStepSchema.safeParse({ pseudo, gender: "woman", placeId: "12" }).success, pseudo).toBe(false);
    }
  });

  it("requires a city picked from the list", () => {
    const result = identityStepSchema.safeParse({ pseudo: "Rebelle", gender: "man", placeId: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(firstErrors(result.error).placeId).toBe("cityRequired");
  });
});

describe("seeking step", () => {
  it("requires genders, a coherent age range and the explicit consent", () => {
    expect(seekingStepSchema.safeParse({ genders: ["woman"], ageMin: "25", ageMax: "40", consent: "on" }).success).toBe(true);
    const result = seekingStepSchema.safeParse({ genders: [], ageMin: "40", ageMax: "25" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = firstErrors(result.error);
      expect(errors.genders).toBe("gendersRequired");
      expect(errors.consent).toBe("consentRequired");
    }
  });
});
