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

  it("has 8 steps for both roles, ending with L'Interrogatoire (SPEC v7.4 §4)", () => {
    expect(lastStep("bad")).toBe(8);
    expect(lastStep("visitor")).toBe(8);
    expect(stepKind("bad", 8)).toBe("interrogation");
    expect(stepKind("visitor", 8)).toBe("interrogation");
    expect(stepKind("bad", 9)).toBeNull();
    expect(stepKind("visitor", 0)).toBeNull();
  });

  it("gives the Bad the 3 poses, the Casier and « Teste ton Casier » (steps 5 to 7)", () => {
    expect(onboardingSteps("bad")).toEqual([
      "age",
      "identity",
      "role",
      "seeking",
      "poses",
      "casier",
      "casierCheck",
      "interrogation",
    ]);
    expect(stepNumber("visitor", "poses")).toBe(0);
    expect(stepNumber("bad", "photo")).toBe(0);
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
      "interrogation",
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
