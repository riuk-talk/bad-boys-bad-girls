import { describe, expect, it } from "vitest";
import { authErrorKey } from "@/lib/auth/errors";

describe("authErrorKey", () => {
  it.each([
    [{ code: "invalid_credentials" }, "invalidCredentials"],
    [{ code: "email_not_confirmed" }, "emailNotConfirmed"],
    [{ code: "over_email_send_rate_limit" }, "rateLimited"],
    [{ status: 429 }, "rateLimited"],
    [{ code: "captcha_failed" }, "captchaFailed"],
    [{ code: "weak_password" }, "weakPassword"],
    [{ code: "otp_expired" }, "linkInvalid"],
    [{ status: 403, message: "email_banned" }, "emailBanned"],
    [{ code: "something_new", message: "Database error" }, "generic"],
  ])("%j → %s", (error, key) => {
    expect(authErrorKey(error)).toBe(key);
  });
});
