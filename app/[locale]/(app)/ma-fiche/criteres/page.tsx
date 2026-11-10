import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SeekingStepForm } from "@/components/onboarding/forms";
import { ButtonLink } from "@/components/ui/button-link";
import { requireRole } from "@/lib/relations/server";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Criteria" });
  return { title: t("title") };
}

/**
 * « Mes critères » (10d), in Ma fiche, for a Bad and a Visitor: the genders and the age range
 * sought, with the rules of the onboarding (Zod, then the checks of the table) and the same
 * art. 9 consent, recorded again with each change.
 */
export default async function CriteriaPage({ searchParams }: Props) {
  const { role, profile } = await requireRole();
  const t = await getTranslations("Criteria");
  const { saved } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85">{t(`lead_${role}`)}</p>
        {saved === "1" ? (
          <p role="status" className="text-accent font-semibold">
            {t("saved")}
          </p>
        ) : null}
      </div>
      <SeekingStepForm
        role={role}
        genders={profile.seeking_genders}
        ageMin={profile.seek_age_min}
        ageMax={profile.seek_age_max}
        context="file"
      />
      <ButtonLink href={role === "visitor" ? "/decouverte" : "/ma-fiche"} variant="ghost">
        {role === "visitor" ? t("toDiscover") : t("back")}
      </ButtonLink>
    </div>
  );
}
