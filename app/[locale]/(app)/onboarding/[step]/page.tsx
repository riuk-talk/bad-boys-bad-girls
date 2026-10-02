import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  AgeStepForm,
  IdentityStepForm,
  PhotoStepForm,
  SeekingStepForm,
} from "@/components/onboarding/forms";
import { StepShell } from "@/components/onboarding/step-shell";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { ONBOARDING_STEPS, stepPath } from "@/lib/onboarding/config";

type Props = { params: Promise<{ locale: string; step: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Onboarding" });
  return { title: t("title") };
}

export default async function OnboardingStep({ params }: Props) {
  const step = Number((await params).step);
  if (!Number.isInteger(step) || step < 1 || step > ONBOARDING_STEPS) notFound();

  const member = await requireMember();
  const { data: profile } = await member.supabase
    .from("profiles")
    .select(
      "birthdate, pseudo, gender, place_id, seeking_genders, seek_age_min, seek_age_max, onboarding_step, onboarding_completed_at",
    )
    .eq("id", member.userId)
    .maybeSingle();
  const locale = await getLocale();
  if (profile?.onboarding_completed_at) return redirect({ href: "/ma-fiche", locale });
  // Steps must be done in order; a later step is not reachable yet.
  const allowed = Math.min((profile?.onboarding_step ?? 0) + 1, ONBOARDING_STEPS);
  if (step > allowed) return redirect({ href: stepPath(allowed), locale });

  let placeLabel: string | null = null;
  if (profile?.place_id) {
    const { data: place } = await member.supabase
      .from("places")
      .select("name, postal_codes")
      .eq("id", profile.place_id)
      .maybeSingle();
    if (place) placeLabel = `${place.name} (${place.postal_codes[0] ?? ""})`;
  }

  return (
    <StepShell step={step}>
      {step === 1 ? <AgeStepForm birthdate={profile?.birthdate ?? ""} /> : null}
      {step === 2 ? (
        <IdentityStepForm
          pseudo={profile?.pseudo ?? ""}
          gender={profile?.gender ?? null}
          place={
            profile?.place_id && placeLabel ? { id: profile.place_id, label: placeLabel } : null
          }
        />
      ) : null}
      {step === 3 ? (
        <SeekingStepForm
          genders={profile?.seeking_genders ?? []}
          ageMin={profile?.seek_age_min ?? 18}
          ageMax={profile?.seek_age_max ?? 99}
        />
      ) : null}
      {step === 4 ? <PhotoStepForm /> : null}
    </StepShell>
  );
}
