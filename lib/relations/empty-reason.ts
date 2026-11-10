/**
 * Why a Visitor's Découverte or Promenade is empty (10d), as search_empty_reason() says it; null
 * when there is no such reason (Bads fit both ways) or the answer is not one of these.
 */
export const EMPTY_REASONS = ["zone_closed", "no_bad_matches", "no_bad_accepts"] as const;
export type EmptyReason = (typeof EMPTY_REASONS)[number];

export function parseEmptyReason(value: unknown): EmptyReason | null {
  return typeof value === "string" && (EMPTY_REASONS as readonly string[]).includes(value)
    ? (value as EmptyReason)
    : null;
}
