"use server";

import {
  emailChangeSchema,
  emailUpdateOutcome,
  passwordChangeSchema,
  passwordUpdateMessage,
  sameAddress,
  type SecurityMessage,
  type SecurityState,
} from "@/lib/auth/account-security";
import { captchaTokenFrom } from "@/lib/auth/captcha";
import { confirmUrl } from "@/lib/auth/redirects";
import { requireMember } from "@/lib/auth/user";
import { verifyPassword } from "@/lib/auth/verify-password";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldErrors, type AuthErrorKey } from "@/lib/validation/auth";

function invalid(fields: Partial<Record<string, AuthErrorKey>>): SecurityState {
  return { status: "error", fields };
}

function failed(message: SecurityMessage): SecurityState {
  return { status: "error", message };
}

/** The member and the address of their account, read from Supabase Auth (never from the form). */
async function account() {
  const member = await requireMember();
  const { data } = await member.supabase.auth.getUser();
  const email = data.user?.email;
  if (!email || data.user?.id !== member.userId) return null;
  return { member, email };
}

/** One of the 3 changes of the day (database, 10j): « too many » past that. */
async function claim(
  member: Awaited<ReturnType<typeof requireMember>>,
  kind: "password" | "email",
): Promise<SecurityMessage | null> {
  const { error } = await member.supabase.rpc("claim_account_change", { p_kind: kind });
  if (!error) return null;
  return error.message.includes("too_many_changes") ? "tooManyChanges" : "generic";
}

/**
 * Changer de mot de passe: the current one, the new one (the sign-up policy: 12 characters), the
 * anti-robot check. Then every other session of the account is closed; Supabase Auth sends
 * « Ton mot de passe a changé » to the address of the account (security notification).
 */
export async function changePasswordAction(
  _state: SecurityState,
  form: FormData,
): Promise<SecurityState> {
  const parsed = passwordChangeSchema.safeParse({
    current: form.get("current"),
    password: form.get("password"),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  if (parsed.data.current === parsed.data.password) return failed("samePassword");
  const found = await account();
  if (!found) return failed("generic");
  const { member, email } = found;

  const check = await verifyPassword(email, parsed.data.current, captchaTokenFrom(form));
  if (check !== "ok") return failed(check);
  const refused = await claim(member, "password");
  if (refused) return failed(refused);

  const { error } = await member.supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return failed(passwordUpdateMessage(error));
  // This browser stays signed in; every other one is signed out.
  const { error: others } = await member.supabase.auth.signOut({ scope: "others" });
  if (others) return failed("generic");
  return { status: "done" };
}

/**
 * Changer d'e-mail: the new address, the current password, the anti-robot check. Supabase Auth
 * sends the same message to the new address and to the current one (double confirmation): the
 * address changes only once both links are opened. A banned address is refused (as at sign-up);
 * an address already used gets the same answer as a free one. Never the super admin's account.
 */
export async function changeEmailAction(
  _state: SecurityState,
  form: FormData,
): Promise<SecurityState> {
  const parsed = emailChangeSchema.safeParse({
    email: form.get("email"),
    current: form.get("current"),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  const found = await account();
  if (!found) return failed("generic");
  const { member, email } = found;
  const next = parsed.data.email.toLowerCase();
  if (sameAddress(next, email)) return failed("sameEmail");
  const { data: role } = await member.supabase.rpc("my_admin_role");
  if (role === "super_admin") return failed("superAdmin");

  const check = await verifyPassword(email, parsed.data.current, captchaTokenFrom(form));
  if (check !== "ok") return failed(check);
  const { data: banned, error: lookup } = await createAdminClient().rpc("email_is_banned", {
    p_email: next,
  });
  if (lookup) return failed("generic");
  if (banned) return failed("emailBanned");
  const refused = await claim(member, "email");
  if (refused) return failed(refused);

  const { error } = await member.supabase.auth.updateUser(
    { email: next },
    { emailRedirectTo: confirmUrl("/ma-fiche/e-mail") },
  );
  if (error) {
    const outcome = emailUpdateOutcome(error);
    if (outcome !== "sent") return failed(outcome);
  }
  return { status: "sent", to: next };
}
