import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminMfa } from "@/components/admin/admin-mfa";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "AdminAccess" });
  return { title: t("title") };
}

/** The second factor before /admin (Phase 5a-ter). Members who are not admins never see it. */
export default async function AdminAccessPage() {
  const member = await requireMember();
  const { data: role } = await member.supabase.rpc("my_admin_role");
  if (role !== "admin" && role !== "super_admin") notFound();
  if (member.aal === "aal2") return redirect({ href: "/admin/greffe", locale: await getLocale() });
  const t = await getTranslations("AdminAccess");
  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl tracking-wide uppercase">{t("title")}</h1>
      <AdminMfa />
    </div>
  );
}
