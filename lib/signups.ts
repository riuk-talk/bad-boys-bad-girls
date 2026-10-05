import "server-only";

/**
 * Whether new accounts may be created (no production database yet: PROGRESS, checklist before
 * launch). SIGNUPS_OPEN=true|false wins; unset, sign-ups are closed on the production deployment
 * and open everywhere else (previews, local).
 */
export function signupsOpen(): boolean {
  const value = process.env.SIGNUPS_OPEN;
  if (value === "true") return true;
  if (value === "false") return false;
  return process.env.VERCEL_ENV !== "production" && process.env.APP_ENV !== "production";
}
