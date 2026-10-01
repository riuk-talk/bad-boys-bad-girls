import * as z from "zod/mini";

/**
 * Auth form schemas, shared by the client forms and (Phase 2) the server actions.
 * zod/mini keeps the client bundle small (SPEC §18). Error messages are i18n keys under
 * "Auth.errors".
 */
export const PASSWORD_MIN_LENGTH = 12;

export const emailSchema = z.pipe(
  z.string().check(z.trim(), z.minLength(1, "required"), z.maxLength(254, "emailInvalid")),
  z.email("emailInvalid"),
);

export const passwordSchema = z
  .string()
  .check(
    z.minLength(1, "required"),
    z.minLength(PASSWORD_MIN_LENGTH, "passwordTooShort"),
    z.maxLength(128, "passwordTooShort"),
  );

export const signupSchema = z.object({ email: emailSchema, password: passwordSchema });
export const passwordLoginSchema = z.object({
  email: emailSchema,
  password: z.string().check(z.minLength(1, "required")),
});
export const magicLinkSchema = z.object({ email: emailSchema });

export type AuthErrorKey = "required" | "emailInvalid" | "passwordTooShort";

/** First error key per field, ready for `t(\`errors.${key}\`)`. */
export function fieldErrors(error: z.core.$ZodError): Partial<Record<string, AuthErrorKey>> {
  const result: Partial<Record<string, AuthErrorKey>> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (!result[field]) result[field] = issue.message as AuthErrorKey;
  }
  return result;
}
