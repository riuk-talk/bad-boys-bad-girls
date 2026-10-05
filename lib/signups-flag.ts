/**
 * Sign-ups are CLOSED unless SIGNUPS_OPEN is exactly "true" (no production database yet: PROGRESS,
 * checklist before launch). Absent, empty, "TRUE", "1", "yes"… all keep them closed.
 */
export function isSignupsOpen(value: string | undefined): boolean {
  return value === "true";
}
