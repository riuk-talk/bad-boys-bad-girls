import { Check, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { FinishDossierForm } from "@/components/onboarding/forms";
import { ButtonLink } from "@/components/ui/button-link";
import { Link, redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { lastStep, parseRole, ROLE_STEP, stepPath } from "@/lib/onboarding/config";
import { missingStep, parseMissing, shownMissing } from "@/lib/onboarding/missing";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Onboarding.dossier" });
  return { title: t("title") };
}

/**
 * The entry of the onboarding (SPEC §4: save and resume at every step). A member who has not
 * started goes straight to step 1; a member with an unfinished dossier sees what is missing
 * (onboarding_missing(), the rules of complete_onboarding()), a link to each step, and « Terminer
 * mon dossier » once nothing is missing (10d).
 */
export default async function OnboardingEntry() {
  const member = await requireMember();
  const locale = await getLocale();
  // The super admin has no profile and no onboarding (Phase 5a-ter): straight to /admin.
  const { data: adminRole } = await member.supabase.rpc("my_admin_role");
  if (adminRole === "super_admin") return redirect({ href: "/admin", locale });
  const [{ data: profile }, { data: missingData }] = await Promise.all([
    member.supabase
      .from("profiles")
      .select("onboarding_step, onboarding_completed_at, role")
      .eq("id", member.userId)
      .maybeSingle(),
    member.supabase.rpc("onboarding_missing"),
  ]);
  if (profile?.onboarding_completed_at) return redirect({ href: "/ma-fiche", locale });
  const role = parseRole(profile?.role);
  const reachable = role ? lastStep(role) : ROLE_STEP;
  const next = Math.min((profile?.onboarding_step ?? 0) + 1, reachable);
  const missing = parseMissing(missingData);
  // Nothing started yet, or the list cannot be read: the next step, as before.
  if (!profile || !missing) return redirect({ href: stepPath(next), locale });

  const t = await getTranslations("Onboarding.dossier");
  const shown = shownMissing(missing, role);
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <p className="text-accent text-sm font-bold tracking-[0.2em] uppercase">
          {t(role === "visitor" ? "kicker_visitor" : "kicker_bad")}
        </p>
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85">{shown.length > 0 ? t("lead") : t("leadDone")}</p>
      </div>

      {shown.length > 0 ? (
        <section aria-labelledby="missing-title" className="space-y-3">
          <h2 id="missing-title" className="text-lg font-semibold">
            {t("missingTitle")}
          </h2>
          <ul className="border-line divide-line divide-y rounded-[var(--radius-card)] border">
            {shown.map((key) => {
              const step = missingStep(key, role);
              const open = step !== null && step <= next;
              return (
                <li key={key}>
                  {open ? (
                    <Link
                      href={stepPath(step)}
                      className="hover:bg-ink-2 flex min-h-12 items-center gap-3 px-4 py-2"
                    >
                      <span className="flex-1">{t(`items.${key}`)}</span>
                      <span className="text-accent text-sm font-semibold">
                        {t("stepLink", { step })}
                      </span>
                      <ChevronRight aria-hidden="true" className="text-accent size-4" />
                    </Link>
                  ) : (
                    <p className="flex min-h-12 items-center gap-3 px-4 py-2">
                      <span className="flex-1">{t(`items.${key}`)}</span>
                      <span className="text-grey text-sm">
                        {step === null ? t("afterRole") : t("afterPrevious")}
                      </span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <ButtonLink href={stepPath(next)} size="lg" className="w-full">
            {t("resume", { step: next })}
          </ButtonLink>
        </section>
      ) : (
        <section className="space-y-4">
          <p className="text-cream flex items-center gap-2 font-semibold">
            <Check aria-hidden="true" className="text-accent size-5" />
            {t("nothingMissing")}
          </p>
          <FinishDossierForm />
        </section>
      )}
      <p className="text-grey text-sm">{t("saved")}</p>
    </div>
  );
}
