import { LogOut } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { LocalizedLink } from "@/components/i18n/localized-link";

export async function AppHeader({ onboardingDone }: { onboardingDone: boolean }) {
  const t = await getTranslations();
  const linkClass =
    "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-cream hover:text-gold";
  return (
    <header className="border-line/60 border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2 sm:px-6">
        <LocalizedLink
          href={onboardingDone ? "/ma-fiche" : "/onboarding"}
          aria-label={t("Nav.homeLabel")}
          className="inline-flex min-h-11 items-center"
        >
          <Logo className="w-14 sm:w-16" />
        </LocalizedLink>
        <nav aria-label={t("App.navLabel")} className="flex items-center gap-1">
          {onboardingDone ? (
            <>
              <LocalizedLink href="/ma-fiche" className={linkClass}>
                {t("App.myFiche")}
              </LocalizedLink>
              <LocalizedLink href="/ville-bientot" className={linkClass}>
                {t("App.myCity")}
              </LocalizedLink>
            </>
          ) : null}
          <form action={signOutAction}>
            <button type="submit" className={linkClass} aria-label={t("App.signOut")}>
              <LogOut aria-hidden="true" className="size-5" />
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
