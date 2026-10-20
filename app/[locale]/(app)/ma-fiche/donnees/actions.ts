"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getLocale } from "next-intl/server";
import * as z from "zod/mini";
import type { ActionState } from "@/app/[locale]/(app)/relations-actions";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { removeMemberFiles } from "@/lib/cleanup/files";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseConfig } from "@/lib/supabase/config";

const schema = z.object({
  password: z.string().check(z.minLength(1), z.maxLength(200)),
  confirm: z.literal("on"),
});

/**
 * Real deletion of my account (SPEC §10), confirmed by my password: the database closes my cases
 * and erases my messages, the server removes my files, then the Auth account (the rows follow by
 * cascade). The super admin has no profile and cannot be deleted (guarded in the database).
 */
export async function deleteAccountAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = schema.safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { status: "error", message: "deleteConfirmRequired" };
  const member = await requireMember();
  const { data: user } = await member.supabase.auth.getUser();
  const email = user.user?.email;
  if (!email || user.user?.id !== member.userId) return { status: "error", message: "generic" };

  // The password is checked with a throw-away client: the current session is left as it is.
  const { url, publishableKey } = supabaseConfig();
  const checker = createSupabaseClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: wrong } = await checker.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });
  if (wrong) return { status: "error", message: "wrongPassword" };

  const { data: files, error } = await member.supabase.rpc("prepare_my_account_deletion");
  const row = files?.[0];
  if (error || !row) return { status: "error", message: "generic" };
  const admin = createAdminClient();
  if (!(await removeMemberFiles(admin, member.userId, row.pending_paths, row.public_paths))) {
    return { status: "error", message: "generic" };
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(member.userId);
  if (deleteError) return { status: "error", message: "generic" };
  await member.supabase.auth.signOut();
  return redirect({ href: "/?compte=supprime", locale: await getLocale() });
}
