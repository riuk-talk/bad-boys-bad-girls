/**
 * The anti-robot check (Cloudflare Turnstile, verified by Supabase Auth) seen from a form: while
 * it is required and has given no token, the submit button stays disabled, with a message.
 *
 * - "off": no site key (local development, preview): nothing is asked, the form works as before.
 * - "loading": the widget is loading or checking; also after a token expired (Turnstile renews it).
 * - "ready": a token was given; it is single-use (the widget is mounted again after a submission).
 * - "error": the widget reported an error, or its script did not load within LOAD_TIMEOUT_MS.
 */
export type CaptchaStatus = "off" | "loading" | "ready" | "error";

export type CaptchaState = { status: CaptchaStatus; token: string | null };

export type CaptchaEvent =
  | { type: "token"; token: string }
  | { type: "expired" }
  | { type: "error" }
  | { type: "timeout" }
  | { type: "retry" };

/** How long the script of Turnstile may take to load before the form says it failed. */
export const LOAD_TIMEOUT_MS = 10_000;

export function initialCaptcha(siteKey: string | undefined): CaptchaState {
  return siteKey ? { status: "loading", token: null } : { status: "off", token: null };
}

export function captchaReducer(state: CaptchaState, event: CaptchaEvent): CaptchaState {
  if (state.status === "off") return state;
  switch (event.type) {
    case "token":
      return event.token ? { status: "ready", token: event.token } : state;
    case "expired":
    case "retry":
      return { status: "loading", token: null };
    case "error":
      return { status: "error", token: null };
    case "timeout":
      // The timeout only means « the script did not come »: a widget already shown keeps going.
      return state.status === "loading" && state.token === null
        ? { status: "error", token: null }
        : state;
  }
}

/** What the form shows: is sending allowed, and which notice goes next to the button. */
export function captchaGate(state: CaptchaState): {
  blocked: boolean;
  notice: "checking" | "unavailable" | null;
} {
  switch (state.status) {
    case "off":
      return { blocked: false, notice: null };
    case "ready":
      return state.token ? { blocked: false, notice: null } : { blocked: true, notice: "checking" };
    case "loading":
      return { blocked: true, notice: "checking" };
    case "error":
      return { blocked: true, notice: "unavailable" };
  }
}

/** The form field where Turnstile puts its token, read by the server actions. */
export const CAPTCHA_FIELD = "cf-turnstile-response";

/** The token of a submitted form, passed to Supabase Auth as `captchaToken`; undefined if none. */
export function captchaTokenFrom(form: FormData): string | undefined {
  const token = form.get(CAPTCHA_FIELD);
  return typeof token === "string" && token.length > 0 && token.length <= 4096 ? token : undefined;
}
