import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  AgeStepForm,
  IdentityStepForm,
  MotiveStepForm,
  PhotoStepForm,
  PracticeStepForm,
  RoleStepForm,
  SeekingStepForm,
} from "@/components/onboarding/forms";
import { CasierCheck, CasierStepForm } from "@/components/onboarding/casier";
import { PosesStepForm } from "@/components/onboarding/poses";
import { StepShell } from "@/components/onboarding/step-shell";
import { QuestionForm } from "@/components/interrogation/question-form";
import { Link, redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { caseNumberFromId } from "@/lib/case-number";
import { loadCliches } from "@/lib/casier-server";
import { loadQuestions } from "@/lib/interrogation-server";
import { lastStep, parseRole, ROLE_STEP, stepKind, stepPath } from "@/lib/onboarding/config";
import { photoInfos } from "@/lib/photos";

type Props = {
  params: Promise<{ locale: string; step: string }>;
  searchParams: Promise<{ q?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Onboarding" });
  return { title: t("title") };
}

export default async function OnboardingStep({ params, searchParams }: Props) {
  const step = Number((await params).step);
  if (!Number.isInteger(step) || step < 1) notFound();

  const member = await requireMember();
  // The super admin has no profile and no onboarding (Phase 5a-ter).
  const { data: adminRole } = await member.supabase.rpc("my_admin_role");
  if (adminRole === "super_admin" || adminRole === "admin") {
    return redirect({ href: "/admin", locale: await getLocale() });
  }
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

  if (kind === "poses") {
    return (
      <StepShell step={step} role={role} kind={kind}>
        <PosesStepForm photos={await photoInfos(member.supabase, member.userId, [0, 1, 2])} />
      </StepShell>
    );
  }

  if (kind === "casier" || kind === "casierCheck") {
    const { data: casier } = await member.supabase
      .from("casier_charges")
      .select("charge_1, charge_2, charge_3, true_index")
      .eq("profile_id", member.userId)
      .maybeSingle();
    const cliches = await loadCliches(member.supabase);
    const charges = casier
      ? ([casier.charge_1, casier.charge_2, casier.charge_3] as [string, string, string])
      : null;
    if (kind === "casierCheck") {
      if (!casier || !charges) return redirect({ href: stepPath(step - 1), locale });
      return (
        <StepShell step={step} role={role} kind={kind}>
          <CasierCheck
            charges={charges}
            trueIndex={casier.true_index}
            caseNumber={caseNumberFromId(member.userId)}
            reworkHref={stepPath(step - 1)}
            context="onboarding"
            cliches={cliches}
          />
        </StepShell>
      );
    }
    // The assistant starts with the true line, then the two false ones.
    const initial: [string, string, string] =
      casier && charges
        ? [
            charges[casier.true_index - 1] ?? "",
            ...(charges.filter((_, index) => index !== casier.true_index - 1) as [string, string]),
          ]
        : ["", "", ""];
    return (
      <StepShell step={step} role={role} kind={kind}>
        <CasierStepForm initial={initial} context="onboarding" cliches={cliches} />
      </StepShell>
    );
  }

  if (kind === "interrogation") {
    const t = await getTranslations("Interrogation");
    const questions = await loadQuestions(member.supabase, member.userId, locale, "core");
    const firstOpen = questions.findIndex((question) => !question.answer);
    const asked = Number((await searchParams).q);
    const index =
      Number.isInteger(asked) && asked >= 1 && asked <= questions.length
        ? asked - 1
        : Math.max(firstOpen, 0);
    const question = questions[index];
    if (!question) notFound();
    const total = questions.length;
    const isLast = questions.every((other, i) => i === index || other.answer);
    return (
      <StepShell
        step={step}
        role={role}
        kind={kind}
        kicker={t("kicker", { current: index + 1, total })}
        heading={question.label}
        aside={t("questionOf", { current: index + 1, total })}
      >
        <QuestionForm
          key={question.id}
          question={question}
          context="onboarding"
          submitLabel={isLast ? t(`finish_${role}`) : t("next")}
        />
        {index > 0 ? (
          <p className="mt-2 text-center">
            <Link
              href={`${stepPath(step)}?q=${index}`}
              className="text-cream inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
            >
              {t("previous")}
            </Link>
          </p>
        ) : null}
      </StepShell>
    );
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
      {kind === "practice" ? <PracticeStepForm /> : null}
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
