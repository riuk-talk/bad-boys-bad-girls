import "server-only";
import { getLocale } from "next-intl/server";
import { forbidden, notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import type { AdminPermission } from "./permissions";

/**
 * An admin page (10f): no role at all, the page does not exist (404); a role without the second
 * factor, /acces-admin first; a role without this permission, 403. The functions of the page ask
 * the database again (has_admin_permission).
 */
export async function requireAdminPermission(permission: AdminPermission) {
  const member = await requireMember();
  const { data: role } = await member.supabase.rpc("my_admin_role");
  if (role !== "admin" && role !== "super_admin") notFound();
  if (member.aal !== "aal2") return redirect({ href: "/acces-admin", locale: await getLocale() });
  const { data: allowed } = await member.supabase.rpc("has_admin_permission", {
    p_permission: permission,
  });
  if (allowed !== true) forbidden();
  return member;
}

/** Whether the connected admin holds this permission (to show or hide an action of a page). */
export async function adminCan(
  member: Awaited<ReturnType<typeof requireMember>>,
  permission: AdminPermission,
): Promise<boolean> {
  const { data } = await member.supabase.rpc("has_admin_permission", { p_permission: permission });
  return data === true;
}
