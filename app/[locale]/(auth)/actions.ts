"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { authErrorKey, type AuthMessageKey } from "@/lib/auth/errors";
import { confirmUrl } from "@/lib/auth/redirects";
import { parseRole } from "@/lib/onboarding/config";
import { signupsOpen } from "@/lib/signups";
import { createClient } from "@/lib/supabase/server";
import {
  fieldErrors,
  magicLinkSchema,
  passwordLoginSchema,
  passwordSchema,
  signupSchema,
  type AuthErrorKey,
} from "@/lib/validation/auth";
import * as z from "zod/mini";

export type AuthState =
  | { status: "idle" }
  | { status: "error"; fields?: Partial<Record<string, AuthErrorKey>>; message?: AuthMessageKey }
  | { status: "sent"; kind: "signup" | "magic" | "reset" };

const CAPTCHA_FIELD = "cf-turnstile-response";

function captchaToken(form: FormData): string | undefined {
  const token = form.get(CAPTCHA_FIELD);
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

function invalid(error: z.core.$ZodError): AuthState {
  return { status: "error", fields: fieldErrors(error) };
}

async function goTo(href: string): Promise<never> {
  return redirect({ href, locale: await getLocale() });
}

export async function signUpAction(_state: AuthState, form: FormData): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return invalid(parsed.error);
  if (!signupsOpen()) return { status: "error", message: "signupsClosed" };
  const ref = String(form.get("ref") ?? "").toUpperCase();
  const role = parseRole(form.get("role"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...parsed.data,
    options: {
      emailRedirectTo: confirmUrl("/onboarding"),
      captchaToken: captchaToken(form),
      // Referral code (SPEC §3) claimed by the database at onboarding step 1; the door chosen on
      // the landing (SPEC v7 §2 bis) only preselects step 3, where the database records the role.
      data: { ...(/^[A-Z2-9]{8}$/.test(ref) ? { ref } : {}), ...(role ? { role } : {}) },
    },
  });
  // Existing addresses get the same answer (no account enumeration).
  if (error && error.code !== "user_already_exists")
    return { status: "error", message: authErrorKey(error) };
  return { status: "sent", kind: "signup" };
}

export async function signInAction(_state: AuthState, form: FormData): Promise<AuthState> {
  if (form.get("mode") === "magic") {
    const parsed = magicLinkSchema.safeParse({ email: form.get("email") });
    if (!parsed.success) return invalid(parsed.error);
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: {
        emailRedirectTo: confirmUrl("/onboarding"),
        captchaToken: captchaToken(form),
        // A magic link creates an account for an unknown address: not while sign-ups are closed.
        shouldCreateUser: signupsOpen(),
      },
    });
    // Unknown address while sign-ups are closed: same answer as for a known one (no enumeration).
    const refusedSignup =
      error?.code === "otp_disabled" || /signups not allowed/i.test(error?.message ?? "");
    if (error && !refusedSignup) return { status: "error", message: authErrorKey(error) };
    return { status: "sent", kind: "magic" };
  }

  const parsed = passwordLoginSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    ...parsed.data,
    options: { captchaToken: captchaToken(form) },
  });
  if (error) return { status: "error", message: authErrorKey(error) };
  return goTo("/onboarding");
}

export async function sendResetAction(_state: AuthState, form: FormData): Promise<AuthState> {
  const parsed = magicLinkSchema.safeParse({ email: form.get("email") });
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: confirmUrl("/nouveau-mot-de-passe"),
    captchaToken: captchaToken(form),
  });
  if (error && error.status === 429) return { status: "error", message: "rateLimited" };
  return { status: "sent", kind: "reset" };
}

export async function updatePasswordAction(_state: AuthState, form: FormData): Promise<AuthState> {
  const parsed = z
    .object({ password: passwordSchema })
    .safeParse({ password: form.get("password") });
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { status: "error", message: authErrorKey(error) };
  return goTo("/onboarding");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await goTo("/");
}
