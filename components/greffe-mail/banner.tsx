import { Mail } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** « Le Greffe t'a écrit » (10g): shown while the member has unread messages of the team. */
export async function GreffeMailBanner({ unread }: { unread: number }) {
  if (unread <= 0) return null;
  const t = await getTranslations("GreffeMail");
  return (
    <Link
      href="/ma-fiche/courrier-du-greffe"
      className="border-accent bg-accent/10 text-cream flex min-h-12 items-center gap-3 rounded-lg border px-4 py-3 font-semibold"
      data-testid="greffe-banner"
    >
      <Mail aria-hidden="true" className="text-accent size-5 shrink-0" />
      <span className="flex-1">{t("banner", { count: unread })}</span>
      <span className="text-accent text-sm underline underline-offset-4">{t("bannerOpen")}</span>
    </Link>
  );
}
