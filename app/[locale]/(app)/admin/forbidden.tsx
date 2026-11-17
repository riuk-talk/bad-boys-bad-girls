import { ShieldOff } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * 403 inside /admin (10f): the page exists but the role of the connected admin does not open it.
 * The menu beside it shows only what the role opens.
 */
export default async function AdminForbidden() {
  const t = await getTranslations("Admin.forbidden");
  return (
    <div className="mx-auto max-w-2xl space-y-3 px-4 py-12 sm:px-6">
      <ShieldOff aria-hidden="true" className="text-accent size-10" />
      <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
      <p className="text-cream/85">{t("body")}</p>
    </div>
  );
}
