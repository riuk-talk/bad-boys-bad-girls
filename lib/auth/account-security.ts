import * as z from "zod/mini";
import { emailSchema, passwordSchema } from "@/lib/validation/auth";

/**
 * Ma fiche › Mon compte (10j): change one's password, change one's e-mail. Both ask the current
 * password and the anti-robot check; Supabase Auth makes the change and sends the e-mails.
 */

export const currentPasswordSchema = z
  .string()
  .check(z.minLength(1, "required"), z.maxLength(200, "required"));

export const passwordChangeSchema = z.object({
  current: currentPasswordSchema,
  password: passwordSchema,
});

export const emailChangeSchema = z.object({
  email: emailSchema,
  current: currentPasswordSchema,
});

export type FieldKey = "required" | "emailInvalid" | "passwordTooShort";

export type SecurityMessage =
  | "wrongPassword"
  | "captchaFailed"
  | "rateLimited"
  | "tooManyChanges"
  | "samePassword"
  | "weakPassword"
  | "secondFactorRequired"
  | "signInAgain"
  | "sameEmail"
  | "emailBanned"
  | "superAdmin"
  | "generic";

export type SecurityState =
  | { status: "idle" }
  | {
      status: "error";
      fields?: Partial<Record<"current" | "password" | "email", FieldKey>>;
      message?: SecurityMessage;
    }
  | { status: "done" }
  | { status: "sent"; to: string };

/** An error of Supabase Auth while changing the password, as a message of the page. */
export function passwordUpdateMessage(error: { code?: string; status?: number }): SecurityMessage {
  switch (error.code) {
    case "same_password":
      return "samePassword";
    case "weak_password":
      return "weakPassword";
    // An account with a second factor changes its password only at aal2.
    case "insufficient_aal":
      return "secondFactorRequired";
    // « Secure password change » on: a session older than allowed must sign in again.
    case "reauthentication_needed":
    case "reauthentication_not_valid":
      return "signInAgain";
    case "over_request_rate_limit":
      return "rateLimited";
    default:
      return error.status === 429 ? "rateLimited" : "generic";
  }
}

/**
 * An error of Supabase Auth while asking for a new address. An address already used by another
 * account gets the same answer as a free one (no account enumeration): « sent ».
 */
export function emailUpdateOutcome(error: {
  code?: string;
  status?: number;
  message?: string;
}): "sent" | SecurityMessage {
  if (error.code === "email_exists" || error.code === "user_already_exists") return "sent";
  // The guard of the database (a banned address, a super admin), seen through Supabase Auth.
  if (error.message?.includes("email_banned")) return "emailBanned";
  if (error.message?.includes("super_admin_protected")) return "superAdmin";
  if (error.code === "over_email_send_rate_limit" || error.status === 429) return "rateLimited";
  return "generic";
}

/** The same address, whatever its case and spaces. */
export function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
