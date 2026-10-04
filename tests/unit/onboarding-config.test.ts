import { describe, expect, it } from "vitest";
import {
  lastStep,
  onboardingSteps,
  parseRole,
  ROLE_STEP,
  stepKind,
  stepNumber,
} from "@/lib/onboarding/config";
import { motiveStepSchema, roleStepSchema } from "@/lib/validation/onboarding";

describe("onboarding steps per role (SPEC v7 §4)", () => {
  it("shares the first three steps, the role being chosen at step 3", () => {
    expect(onboardingSteps("bad").slice(0, 3)).toEqual(["age", "identity", "role"]);
    expect(onboardingSteps("visitor").slice(0, 3)).toEqual(["age", "identity", "role"]);
    expect(ROLE_STEP).toBe(3);
  });

  it("ends at the photo for a Bad and at the Motif de visite for a Visitor (Phase 2b)", () => {
    expect(stepKind("bad", lastStep("bad"))).toBe("photo");
    expect(stepKind("visitor", lastStep("visitor"))).toBe("motive");
    expect(stepKind("bad", 6)).toBeNull();
    expect(stepKind("visitor", 0)).toBeNull();
  });

  it("puts « Entraîne-toi » right after the role, for the Visitor only (Phase 2c)", () => {
    expect(stepNumber("visitor", "practice")).toBe(ROLE_STEP + 1);
    expect(stepNumber("bad", "practice")).toBe(0);
    expect(onboardingSteps("visitor")).toEqual([
      "age",
      "identity",
      "role",
      "practice",
      "seeking",
      "photo",
      "motive",
    ]);
  });

  it("only accepts the two roles", () => {
    expect(parseRole("bad")).toBe("bad");
    expect(parseRole("visitor")).toBe("visitor");
    expect(parseRole("admin")).toBeNull();
    expect(parseRole(undefined)).toBeNull();
  });
});

describe("role and Motif de visite validation", () => {
  it("requires a known role", () => {
    expect(roleStepSchema.safeParse({ role: "visitor" }).success).toBe(true);
    expect(roleStepSchema.safeParse({ role: "admin" }).success).toBe(false);
    expect(roleStepSchema.safeParse({}).success).toBe(false);
  });

  it("requires a non-empty motive of at most 280 characters", () => {
    expect(motiveStepSchema.safeParse({ motive: "Je viens pour le rock." }).success).toBe(true);
    expect(motiveStepSchema.safeParse({ motive: "   " }).success).toBe(false);
    expect(motiveStepSchema.safeParse({ motive: "x".repeat(281) }).success).toBe(false);
    expect(motiveStepSchema.safeParse({ motive: "x".repeat(280) }).success).toBe(true);
  });
});
