/** Member roles (SPEC v7 §2 bis). Mirrors the `member_role` enum. */
export const ROLES = ["bad", "visitor"] as const;
export type Role = (typeof ROLES)[number];

export function parseRole(value: unknown): Role | null {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
    ? (value as Role)
    : null;
}

/**
 * Onboarding steps per role (SPEC v7 §4). Steps 1–3 are common; the role is chosen at step 3.
 * Phase 2b: the Bad finishes at the photo, the Visitor at the Motif de visite.
 * Phase 3 adds the Casier (Bad, step 6) and the 10 core questions (both, step 7).
 */
export type StepKind = "age" | "identity" | "role" | "seeking" | "photo" | "motive";

const STEPS: Record<Role, readonly StepKind[]> = {
  bad: ["age", "identity", "role", "seeking", "photo"],
  visitor: ["age", "identity", "role", "seeking", "photo", "motive"],
};

export function onboardingSteps(role: Role): readonly StepKind[] {
  return STEPS[role];
}

/** Kind of step `step` (1-based) for this role, or null when out of range. */
export function stepKind(role: Role, step: number): StepKind | null {
  return STEPS[role][step - 1] ?? null;
}

export function lastStep(role: Role): number {
  return STEPS[role].length;
}

/** The step where the role is chosen; later steps depend on it. */
export const ROLE_STEP = STEPS.bad.indexOf("role") + 1;

/** The Motif de visite of a Visitor (SPEC v7 §5 bis). */
export const VISIT_MOTIVE_MAX = 280;

/** Versions of the texts the member agrees to (stored with each consent, SPEC §10). */
export const CONSENT_VERSIONS = {
  terms: "cgu-2026-10-draft-2",
  privacy: "privacy-2026-10-draft-2",
  age_18: "age-attestation-v1",
  art9_seeking: "art9-seeking-v2",
} as const;

export function stepPath(step: number): string {
  return `/onboarding/${step}`;
}
