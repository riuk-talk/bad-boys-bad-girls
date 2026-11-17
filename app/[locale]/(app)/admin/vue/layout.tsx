import type { ReactNode } from "react";
import { Eye } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdminPermission } from "@/lib/admin/guard";

/**
 * La vue Greffe (10a): the site as a Visitor sees it, from the admin, read only. The admin layout
 * above already requires an admin with the second factor; every function used here checks it
 * again (has_admin_permission, 10f). The banner stays on every page of the view.
 */
export default async function GreffeViewLayout({ children }: { children: ReactNode }) {
  // Its own permission (10f): 403 without it.
  await requireAdminPermission("vue_visiteur.view");
  const t = await getTranslations("GreffeView");
  return (
    <div className="flex flex-col">
      <div
        role="note"
        aria-label={t("banner")}
        className="bg-cream text-ink sticky top-0 z-40 border-b-2 border-[#0e0e10] px-4 py-2 sm:px-6"
        data-testid="greffe-banner"
      >
        <p className="mx-auto flex max-w-5xl items-center gap-2 text-sm font-bold">
          <Eye aria-hidden="true" className="size-4 shrink-0" />
          {t("banner")}
        </p>
        <p className="mx-auto max-w-5xl text-xs">{t("bannerHint")}</p>
      </div>
      <nav aria-label={t("tabsLabel")} className="border-line border-b">
        <ul className="mx-auto flex max-w-5xl gap-1 px-4 sm:px-6">
          <li>
            <Link
              href="/admin/vue"
              className="text-cream hover:text-accent inline-flex min-h-11 items-center px-3 text-sm font-semibold"
            >
              {t("discover")}
            </Link>
          </li>
          <li>
            <Link
              href="/admin/vue/promenade"
              className="text-cream hover:text-accent inline-flex min-h-11 items-center px-3 text-sm font-semibold"
            >
              {t("promenade")}
            </Link>
          </li>
        </ul>
      </nav>
      {children}
    </div>
  );
}
