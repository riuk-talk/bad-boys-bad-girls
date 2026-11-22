import type { ReactNode } from "react";
import { getLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { redirect } from "@/i18n/navigation";
import { parseCounts } from "@/lib/admin/nav";
import { parsePermissions } from "@/lib/admin/permissions";
import { requireMember } from "@/lib/auth/user";

// /admin (Phase 5a-ter): admins and the super admin only, and always with a second factor (aal2).
// The database checks the same level and the permission in every admin function
// (has_admin_permission, 10f). The shell (10c): the
// side menu with its groups and live counters, the drawer on mobile, the member search.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const member = await requireMember();
  const { data: role } = await member.supabase.rpc("my_admin_role");
  if (role !== "admin" && role !== "super_admin") notFound();
  if (member.aal !== "aal2") return redirect({ href: "/acces-admin", locale: await getLocale() });
  // The counters of the menu at the first rendering; the shell reads them again every 30 s.
  const [{ data: counts }, { data: permissionsData }] = await Promise.all([
    member.supabase.rpc("admin_counts"),
    // What the role opens (10f): the menu shows only that; each page and function checks again.
    member.supabase.rpc("my_admin_permissions"),
  ]);
  const permissions = parsePermissions(permissionsData);
  // The threads waiting for the team (10g), for a role that opens the Messagerie.
  const { data: unread } = permissions.includes("members.message")
    ? await member.supabase.rpc("admin_messagerie_unread")
    : { data: null };
  return (
    <AdminShell
      initialCounts={parseCounts(Array.isArray(counts) ? counts[0] : counts, unread)}
      permissions={permissions}
    >
      {children}
    </AdminShell>
  );
}
