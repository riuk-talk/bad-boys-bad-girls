/**
 * With the captcha on in the CI stack (E2E_CAPTCHA=true, Cloudflare's test keys, see
 * scripts/ci/local-env.mjs), Supabase Auth asks for a token on sign-up and sign-in: the calls that
 * go straight to the Auth API pass Cloudflare's dummy token, the only one the test secret accepts.
 * Locally, without the captcha, the option is empty.
 */
export const captchaToken = process.env.E2E_CAPTCHA_TOKEN || undefined;
export const captcha = { captchaToken };

/** True when the CI runs with the captcha of Supabase Auth on (Cloudflare's test keys). */
export const captchaOn = process.env.E2E_CAPTCHA === "true" && captchaToken !== undefined;
