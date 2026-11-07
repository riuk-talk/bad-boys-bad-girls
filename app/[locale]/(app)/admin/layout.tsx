import type { ReactNode } from "react";
import { getLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { redirect } from "@/i18n/navigation";
import { parseCounts } from "@/lib/admin/nav";
import { requireMember } from "@/lib/auth/user";

// /admin (Phase 5a-ter): admins and the super admin only, and always with a second factor (aal2).
// The database checks the same level in every admin function (is_admin()). The shell (10c): the
// side menu with its groups and live counters, the drawer on mobile, the member search.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const member = await requireMember();
  const { data: role } = await member.supabase.rpc("my_admin_role");
  if (role !== "admin" && role !== "super_admin") notFound();
  if (member.aal !== "aal2") return redirect({ href: "/acces-admin", locale: await getLocale() });
  // The counters of the menu at the first rendering; the shell reads them again every 30 s.
  const { data: counts } = await member.supabase.rpc("admin_counts");
  return (
    <AdminShell initialCounts={parseCounts(Array.isArray(counts) ? counts[0] : counts)}>
      {children}
    </AdminShell>
  );
}
