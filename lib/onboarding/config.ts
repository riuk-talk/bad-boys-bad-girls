/** Onboarding steps available in Phase 2 (SPEC §4). Phase 3 adds 5 (Casier) and 6 (questions). */
export const ONBOARDING_STEPS = 4;

/** Versions of the texts the member agrees to (stored with each consent, SPEC §10). */
export const CONSENT_VERSIONS = {
  terms: "cgu-2026-10-draft",
  privacy: "privacy-2026-10-draft",
  age_18: "age-attestation-v1",
  art9_seeking: "art9-seeking-v1",
} as const;

export function stepPath(step: number): string {
  return `/onboarding/${step}`;
}
