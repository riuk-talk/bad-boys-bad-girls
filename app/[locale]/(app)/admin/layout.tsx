import type { ReactNode } from "react";
import { getLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";

// /admin (Phase 5a-ter): admins and the super admin only, and always with a second factor (aal2).
// The database checks the same level in every admin function (is_admin()).
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const member = await requireMember();
  const { data: role } = await member.supabase.rpc("my_admin_role");
  if (role !== "admin" && role !== "super_admin") notFound();
  if (member.aal !== "aal2") return redirect({ href: "/acces-admin", locale: await getLocale() });
  return (
    <>
      <AdminNav />
      {children}
    </>
  );
}
