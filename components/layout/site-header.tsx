import { useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button-link";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { LocaleSwitch } from "./locale-switch";

export function SiteHeader({ showAuthLinks = true }: { showAuthLinks?: boolean }) {
  const t = useTranslations();
  return (
    <header className="border-line/60 border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <LocalizedLink
          href="/"
          aria-label={t("Nav.homeLabel")}
          className="inline-flex min-h-11 items-center rounded-md"
        >
          <Logo className="w-16 sm:w-20" />
        </LocalizedLink>
        <nav aria-label={t("Nav.mainLabel")} className="flex items-center gap-1 sm:gap-2">
          {showAuthLinks ? (
            <>
              <ButtonLink href="/connexion" variant="ghost" size="inline">
                {t("Common.login")}
              </ButtonLink>
              {/* Wrapper: "hidden" on the link itself would conflict with the button's display class. */}
              <span className="hidden min-[400px]:block">
                <ButtonLink href="/inscription">{t("Common.signup")}</ButtonLink>
              </span>
            </>
          ) : null}
          <LocaleSwitch />
        </nav>
      </div>
    </header>
  );
}
