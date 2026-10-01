/** Public, non-secret configuration. Secrets are read only in server-only modules. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
  /\/+$/,
  "",
);

/** The dev-only design showcase is hidden when APP_ENV=production (set on Vercel production). */
export const IS_PRODUCTION_DEPLOYMENT = process.env.APP_ENV === "production";
