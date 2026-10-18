/** Maps a Supabase Auth error to an i18n key under "Auth.errors" (never leaks raw messages). */
export type AuthMessageKey =
  | "invalidCredentials"
  | "emailNotConfirmed"
  | "rateLimited"
  | "captchaFailed"
  | "weakPassword"
  | "emailBanned"
  | "linkInvalid"
  | "generic"
  | "configuration"
  | "signupsClosed"
  | "secondFactorRequired";

export function authErrorKey(error: {
  code?: string;
  message?: string;
  status?: number;
}): AuthMessageKey {
  const code = error.code ?? "";
  if (error.message?.includes("email_banned")) return "emailBanned";
  switch (code) {
    case "invalid_credentials":
      return "invalidCredentials";
    case "email_not_confirmed":
      return "emailNotConfirmed";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
    case "over_sms_send_rate_limit":
      return "rateLimited";
    case "captcha_failed":
      return "captchaFailed";
    case "weak_password":
      return "weakPassword";
    // An account with a second factor changes its password only at aal2 (Supabase Auth).
    case "insufficient_aal":
      return "secondFactorRequired";
    case "otp_expired":
    case "flow_state_expired":
    case "flow_state_not_found":
    case "bad_code_verifier":
      return "linkInvalid";
    default:
      return error.status === 429 ? "rateLimited" : "generic";
  }
}
