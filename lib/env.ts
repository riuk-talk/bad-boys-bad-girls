/** Public, non-secret configuration. Secrets are read only in server-only modules. */

// Canonical URL: explicit setting first, then Vercel's system variables (production domain,
// then the preview deployment URL), then local development.
function resolveSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const SITE_URL = resolveSiteUrl().replace(/\/+$/, "");

/** The dev-only design showcase is hidden when APP_ENV=production (set on Vercel production). */
export const IS_PRODUCTION_DEPLOYMENT = process.env.APP_ENV === "production";
