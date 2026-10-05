/** Member roles (SPEC v7 §2 bis). Mirrors the `member_role` enum. */
export const ROLES = ["bad", "visitor"] as const;
export type Role = (typeof ROLES)[number];

export function parseRole(value: unknown): Role | null {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
    ? (value as Role)
    : null;
}

/**
 * Onboarding steps per role (SPEC v7.4 §4): 8 steps for both. Steps 1–3 are common; the role is
 * chosen at step 3. The last step is L'Interrogatoire (the 10 core questions, SPEC §9).
 */
export type StepKind =
  | "age"
  | "identity"
  | "role"
  | "practice"
  | "seeking"
  | "poses"
  | "photo"
  | "casier"
  | "casierCheck"
  | "motive"
  | "interrogation";

const STEPS: Record<Role, readonly StepKind[]> = {
  // "poses" = « Passe à la toise », 3 photos (PARCOURS-DESIGN §3); "casierCheck" = « Teste ton
  // Casier » (LANDING-DESIGN §2.2).
  bad: ["age", "identity", "role", "seeking", "poses", "casier", "casierCheck", "interrogation"],
  // "practice" = « Entraîne-toi » (LANDING-DESIGN.md §2.1): nothing is stored but the step number.
  visitor: ["age", "identity", "role", "practice", "seeking", "photo", "motive", "interrogation"],
};

export function onboardingSteps(role: Role): readonly StepKind[] {
  return STEPS[role];
}

/** Kind of step `step` (1-based) for this role, or null when out of range. */
export function stepKind(role: Role, step: number): StepKind | null {
  return STEPS[role][step - 1] ?? null;
}

/** Number (1-based) of a step kind for this role, or 0 when the role has no such step. */
export function stepNumber(role: Role, kind: StepKind): number {
  return STEPS[role].indexOf(kind) + 1;
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
