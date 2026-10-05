import { LogOut, Phone } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { LocalizedLink } from "@/components/i18n/localized-link";
import type { Role } from "@/lib/onboarding/config";

type Props = { onboardingDone: boolean; role: Role | null; isAdmin?: boolean };

/** The role is read here, never from a colour (PARCOURS-DESIGN §1): bars for a Bad, a handset for a Visitor. */
function RoleTag({ role, label }: { role: Role; label: string }) {
  return (
    <span className="font-stamp text-cream/90 inline-flex items-center gap-1.5 rounded-[3px] border border-[#4a4a50] px-2.5 py-0.5 text-[11px] tracking-[0.15em]">
      {role === "bad" ? (
        <svg aria-hidden="true" viewBox="0 0 14 14" className="size-3.5" fill="currentColor">
          <rect x="1" y="1" width="12" height="1.5" />
          <rect x="1" y="11.5" width="12" height="1.5" />
          <rect x="2.5" y="1" width="1.5" height="12" />
          <rect x="6.25" y="1" width="1.5" height="12" />
          <rect x="10" y="1" width="1.5" height="12" />
        </svg>
      ) : (
        <Phone aria-hidden="true" className="size-3.5" />
      )}
      {label}
    </span>
  );
}

export async function AppHeader({ onboardingDone, role, isAdmin = false }: Props) {
  const t = await getTranslations();
  const linkClass =
    "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-cream hover:text-accent";
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
        {role ? <RoleTag role={role} label={t(`App.roleTag_${role}`)} /> : null}
        <nav aria-label={t("App.navLabel")} className="ml-auto flex items-center gap-1">
          {onboardingDone ? (
            <>
              <LocalizedLink href="/ma-fiche" className={linkClass}>
                {role === "visitor" ? t("App.myPermit") : t("App.myFiche")}
              </LocalizedLink>
              <LocalizedLink href="/quartier" className={linkClass}>
                {t("App.myQuarter")}
              </LocalizedLink>
            </>
          ) : null}
          {isAdmin ? (
            <LocalizedLink href="/admin/greffe" className={linkClass}>
              {t("Greffe.title")}
            </LocalizedLink>
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
