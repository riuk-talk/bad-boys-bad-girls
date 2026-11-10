import { stepNumber, type Role, type StepKind } from "./config";

/**
 * What an unfinished dossier lacks (10d), as onboarding_missing() lists it: the same keys as the
 * refusal of complete_onboarding(), the single source of the rules being in SQL.
 */
export const MISSING_KEYS = [
  "birthdate",
  "consents",
  "identity",
  "role",
  "seeking",
  "consent_art9",
  "photos",
  "photo",
  "casier",
  "visit_motive",
  "core_answers",
] as const;
export type MissingKey = (typeof MISSING_KEYS)[number];

const isKey = (value: unknown): value is MissingKey =>
  typeof value === "string" && (MISSING_KEYS as readonly string[]).includes(value);

/** The list from the database, in the order of the steps; null when it is not a list of keys. */
export function parseMissing(value: unknown): MissingKey[] | null {
  if (!Array.isArray(value) || !value.every(isKey)) return null;
  return MISSING_KEYS.filter((key) => value.includes(key));
}

/** The kind of step where each item is done (for the role chosen). */
const STEP_OF: Record<MissingKey, StepKind> = {
  birthdate: "age",
  consents: "age",
  identity: "identity",
  role: "role",
  seeking: "seeking",
  consent_art9: "seeking",
  photos: "poses",
  photo: "photo",
  casier: "casier",
  visit_motive: "motive",
  core_answers: "interrogation",
};

/** Steps 1 to 3 are common; the next ones need the role to be known. */
const COMMON: readonly StepKind[] = ["age", "identity", "role"];

/**
 * The step (1-based) where a missing item is done, or null when it cannot be known yet (the role
 * is not chosen) or the role has no such step.
 */
export function missingStep(key: MissingKey, role: Role | null): number | null {
  const kind = STEP_OF[key];
  if (COMMON.includes(kind)) return stepNumber("bad", kind);
  if (!role) return null;
  const step = stepNumber(role, kind);
  return step > 0 ? step : null;
}

/** The items to show for this role (a Bad has no « photo », a Visitor no « photos » or Casier). */
export function shownMissing(keys: readonly MissingKey[], role: Role | null): MissingKey[] {
  return keys.filter((key) => {
    if (!role) return true;
    if (key === "photo") return role === "visitor";
    if (key === "photos" || key === "casier") return role === "bad";
    if (key === "visit_motive") return role === "visitor";
    return true;
  });
}
