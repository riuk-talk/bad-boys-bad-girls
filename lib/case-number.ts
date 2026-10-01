/**
 * Decorative case number shown on a Fiche header (SPEC §1 bis), e.g. "BB-0427".
 * Derived deterministically from the profile UUID; it is not an identifier and reveals nothing.
 */
export function caseNumberFromId(id: string): string {
  let hash = 2166136261;
  for (const char of id.replace(/-/g, "").toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `BB-${String(hash % 10000).padStart(4, "0")}`;
}
