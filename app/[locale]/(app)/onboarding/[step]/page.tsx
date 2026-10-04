import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  AgeStepForm,
  IdentityStepForm,
  MotiveStepForm,
  PhotoStepForm,
  RoleStepForm,
  SeekingStepForm,
} from "@/components/onboarding/forms";
import { StepShell } from "@/components/onboarding/step-shell";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { lastStep, parseRole, ROLE_STEP, stepKind, stepPath } from "@/lib/onboarding/config";

type Props = { params: Promise<{ locale: string; step: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Onboarding" });
  return { title: t("title") };
}

export default async function OnboardingStep({ params }: Props) {
  const step = Number((await params).step);
  if (!Number.isInteger(step) || step < 1) notFound();

  const member = await requireMember();
  const { data: profile } = await member.supabase
    .from("profiles")
    .select(
      "birthdate, pseudo, gender, place_id, role, seeking_genders, seek_age_min, seek_age_max, visit_motive, onboarding_step, onboarding_completed_at",
    )
    .eq("id", member.userId)
    .maybeSingle();
  const locale = await getLocale();
  if (profile?.onboarding_completed_at) return redirect({ href: "/ma-fiche", locale });

  // Until step 3 is saved, the door chosen on the landing (account metadata) gives the route.
  const savedRole = parseRole(profile?.role);
  const preferredRole = savedRole ?? parseRole(member.metadata.role);
  const role = preferredRole ?? "bad";
  const kind = stepKind(role, step);
  if (!kind) notFound();

  // Steps must be done in order; after step 3 the route depends on the saved role.
  const reachable = savedRole ? lastStep(savedRole) : ROLE_STEP;
  const allowed = Math.min((profile?.onboarding_step ?? 0) + 1, reachable);
  if (step > allowed) return redirect({ href: stepPath(allowed), locale });

  let placeLabel: string | null = null;
  if (kind === "identity" && profile?.place_id) {
    const { data: place } = await member.supabase
      .from("places")
      .select("name, postal_codes")
      .eq("id", profile.place_id)
      .maybeSingle();
    if (place) placeLabel = `${place.name} (${place.postal_codes[0] ?? ""})`;
  }

  return (
    <StepShell step={step} role={role} kind={kind}>
      {kind === "age" ? <AgeStepForm birthdate={profile?.birthdate ?? ""} /> : null}
      {kind === "identity" ? (
        <IdentityStepForm
          pseudo={profile?.pseudo ?? ""}
          gender={profile?.gender ?? null}
          place={
            profile?.place_id && placeLabel ? { id: profile.place_id, label: placeLabel } : null
          }
        />
      ) : null}
      {kind === "role" ? <RoleStepForm role={preferredRole} /> : null}
      {kind === "seeking" ? (
        <SeekingStepForm
          role={role}
          genders={profile?.seeking_genders ?? []}
          ageMin={profile?.seek_age_min ?? 18}
          ageMax={profile?.seek_age_max ?? 99}
        />
      ) : null}
      {kind === "photo" ? <PhotoStepForm last={step === lastStep(role)} /> : null}
      {kind === "motive" ? <MotiveStepForm motive={profile?.visit_motive ?? ""} /> : null}
    </StepShell>
  );
}
