import { describe, expect, it } from "vitest";
import { composeEmail, missingDetail } from "@/lib/email/compose";
import { lastStep } from "@/lib/onboarding/config";
import { parseEmptyReason } from "@/lib/relations/empty-reason";
import { MISSING_KEYS, missingStep, parseMissing, shownMissing } from "@/lib/onboarding/missing";

describe("unfinished dossier (10d)", () => {
  it("keeps only the keys of onboarding_missing(), in the order of the steps", () => {
    expect(parseMissing(["core_answers", "birthdate", "casier"])).toEqual([
      "birthdate",
      "casier",
      "core_answers",
    ]);
    expect(parseMissing([])).toEqual([]);
    expect(parseMissing(["birthdate", "unknown"])).toBe(null);
    expect(parseMissing(null)).toBe(null);
    expect(parseMissing("birthdate")).toBe(null);
  });

  it("sends each item to its step for the role", () => {
    expect(missingStep("birthdate", null)).toBe(1);
    expect(missingStep("consents", null)).toBe(1);
    expect(missingStep("identity", null)).toBe(2);
    expect(missingStep("role", null)).toBe(3);
    expect(missingStep("seeking", null)).toBe(null);
    expect(missingStep("seeking", "bad")).toBe(4);
    expect(missingStep("consent_art9", "visitor")).toBe(5);
    expect(missingStep("photos", "bad")).toBe(5);
    expect(missingStep("photo", "visitor")).toBe(6);
    expect(missingStep("casier", "bad")).toBe(6);
    expect(missingStep("visit_motive", "visitor")).toBe(7);
    expect(missingStep("core_answers", "bad")).toBe(lastStep("bad"));
    // A role without such a step: no link.
    expect(missingStep("casier", "visitor")).toBe(null);
    for (const key of MISSING_KEYS) {
      for (const role of ["bad", "visitor"] as const) {
        const step = missingStep(key, role);
        if (step !== null) expect(step).toBeLessThanOrEqual(lastStep(role));
      }
    }
  });

  it("shows only what the role has", () => {
    const all = [...MISSING_KEYS];
    expect(shownMissing(all, "bad")).not.toContain("photo");
    expect(shownMissing(all, "bad")).not.toContain("visit_motive");
    expect(shownMissing(all, "visitor")).not.toContain("photos");
    expect(shownMissing(all, "visitor")).not.toContain("casier");
    expect(shownMissing(all, null)).toEqual(all);
  });

  it("says in words what is missing in the e-mail, nothing unknown", () => {
    expect(missingDetail(["casier", "core_answers"], "fr")).toBe(
      "Ton Casier : tes 3 chefs d'accusation ; Les 10 questions de l'Interrogatoire",
    );
    expect(missingDetail(["casier"], "en")).toBe("Your Record: your 3 charges");
    expect(missingDetail(["<b>"], "fr")).toBe(undefined);
    expect(missingDetail([], "fr")).toBe(undefined);
    const email = composeEmail("dossier_incomplete", "fr", "https://example.test", {
      detail: missingDetail(["casier"], "fr"),
    });
    expect(email.subject).toBe("Tes poses sont validées");
    expect(email.text).toContain("Ton Casier");
    expect(email.text).toContain("https://example.test/fr/onboarding");
    const online = composeEmail("fiche_online", "en", "https://example.test");
    expect(online.subject).toBe("Your profile is online");
    expect(online.text).toContain("https://example.test/en/ma-fiche");
  });
});

describe("empty search reasons (10d)", () => {
  it("keeps only the reasons the database gives", () => {
    expect(parseEmptyReason("zone_closed")).toBe("zone_closed");
    expect(parseEmptyReason("no_bad_matches")).toBe("no_bad_matches");
    expect(parseEmptyReason("no_bad_accepts")).toBe("no_bad_accepts");
    expect(parseEmptyReason(null)).toBe(null);
    expect(parseEmptyReason("blocked")).toBe(null);
  });
});
