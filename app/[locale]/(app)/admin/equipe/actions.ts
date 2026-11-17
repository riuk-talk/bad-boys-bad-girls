"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import * as z from "zod/mini";
import { redirect } from "@/i18n/navigation";
import { ROLE_PERMISSIONS } from "@/lib/admin/permissions";
import { requireMember } from "@/lib/auth/user";
import { moderationErrorKey, type ModerationError } from "@/lib/moderation";

/**
 * Équipe (10f). The super admin only: every function checks team.manage again (never a role's),
 * refuses to touch the super admin, and logs the change (who, what, when, before and after).
 */
async function back(error?: ModerationError): Promise<never> {
  revalidatePath("/[locale]/admin", "layout");
  return redirect({
    href: error ? `/admin/equipe?error=${error}` : "/admin/equipe?done=1",
    locale: await getLocale(),
  });
}

const roleId = z.coerce.number().check(z.int(), z.positive(), z.maximum(32767));

const grantSchema = z.object({
  account: z.string().check(z.trim(), z.minLength(3), z.maxLength(254)),
  role: roleId,
});

export async function grantRoleAction(form: FormData): Promise<void> {
  const parsed = grantSchema.safeParse({ account: form.get("account"), role: form.get("role") });
  if (!parsed.success) return back("not_found");
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_grant_role", {
    p_account: parsed.data.account,
    p_role: parsed.data.role,
  });
  return back(error ? moderationErrorKey(error.message) : undefined);
}

export async function revokeRoleAction(form: FormData): Promise<void> {
  const parsed = z.object({ user: z.uuid() }).safeParse({ user: form.get("user") });
  if (!parsed.success) return back("not_found");
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_revoke_role", { p_user: parsed.data.user });
  return back(error ? moderationErrorKey(error.message) : undefined);
}

const roleSchema = z.object({
  role: z.optional(roleId),
  name: z.string().check(z.trim(), z.minLength(2), z.maxLength(40)),
  description: z.optional(z.string().check(z.trim(), z.maxLength(200))),
  permissions: z.array(z.enum(ROLE_PERMISSIONS)),
});

export async function saveRoleAction(form: FormData): Promise<void> {
  const parsed = roleSchema.safeParse({
    role: form.get("role") || undefined,
    name: form.get("name"),
    description: form.get("description") || undefined,
    permissions: form.getAll("permissions"),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return back(
      field === "name"
        ? "invalid_name"
        : field === "description"
          ? "invalid_description"
          : "generic",
    );
  }
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_save_role", {
    p_role: parsed.data.role,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_permissions: parsed.data.permissions,
  });
  return back(error ? moderationErrorKey(error.message) : undefined);
}

export async function deleteRoleAction(form: FormData): Promise<void> {
  const parsed = z.object({ role: roleId }).safeParse({ role: form.get("role") });
  if (!parsed.success) return back("not_found");
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_delete_role", { p_role: parsed.data.role });
  return back(error ? moderationErrorKey(error.message) : undefined);
}
