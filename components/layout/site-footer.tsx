import { useTranslations } from "next-intl";
import { LocalizedLink } from "@/components/i18n/localized-link";

const LINKS = [
  { href: "/charte", key: "charter" },
  { href: "/conseils-securite", key: "safety" },
  { href: "/cgu", key: "terms" },
  { href: "/confidentialite", key: "privacy" },
  { href: "/mentions-legales", key: "notice" },
] as const;

export function SiteFooter() {
  const t = useTranslations("Footer");
  const common = useTranslations("Common");
  return (
    <footer aria-label={t("label")} className="border-line/60 bg-ink-2 mt-auto border-t">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-2">
        <div className="space-y-2">
          <p className="font-display text-2xl tracking-wide uppercase">{common("brand")}</p>
          <p className="font-script text-gold text-2xl">{common("signature")}</p>
          <p className="text-grey">{t("adultsOnly")}</p>
        </div>
        <div>
          <h2 className="text-grey text-sm font-bold tracking-[0.18em] uppercase">
            {t("legalTitle")}
          </h2>
          <ul className="mt-3 grid gap-1">
            {LINKS.map((link) => (
              <li key={link.href}>
                <LocalizedLink
                  href={link.href}
                  className="text-cream hover:text-gold inline-flex min-h-11 items-center underline-offset-4 hover:underline"
                >
                  {t(link.key)}
                </LocalizedLink>
              </li>
            ))}
          </ul>
          <p className="text-grey mt-3 text-sm">{t("contact")}</p>
        </div>
      </div>
      <p className="border-line/60 text-grey border-t px-4 py-4 text-center text-sm">
        {t("copyright", { year: new Date().getFullYear() })}
      </p>
    </footer>
  );
}
