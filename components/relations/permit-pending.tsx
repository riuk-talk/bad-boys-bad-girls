import { Hourglass } from "lucide-react";
import { getTranslations } from "next-intl/server";

/** A Visitor whose face photo is not validated yet can look, not ask (SPEC §5 bis). */
export async function PermitPending() {
  const t = await getTranslations("Relations.permitPending");
  return (
    <p className="border-line bg-ink-2 text-cream/90 flex items-start gap-2.5 rounded-md border p-3 text-sm">
      <Hourglass aria-hidden="true" className="text-accent mt-0.5 size-4 shrink-0" />
      <span>{t("body")}</span>
    </p>
  );
}
