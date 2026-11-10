"use client";

import { Check, ImagePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  finishDossierAction,
  saveAgeStep,
  saveIdentityStep,
  saveMotiveStep,
  savePracticeStep,
  saveRoleStep,
  saveSeekingStep,
  uploadPhotoAction,
  type StepState,
} from "@/app/[locale]/(app)/onboarding/actions";
import { Mugshot } from "@/components/brand/mugshot";
import { FramingGuide } from "@/components/brand/placard";
import { Stamp } from "@/components/brand/stamp";
import { Toise } from "@/components/brand/toise";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { submitWithoutReset } from "@/lib/forms/submit";
import { ROLES, VISIT_MOTIVE_MAX, type Role } from "@/lib/onboarding/config";
import { Constants, type Database } from "@/lib/supabase/database.types";
import { CityPicker } from "./city-picker";
import { prepareForUpload, useCutoutChoice, usePreloadCutout } from "./cutout-choice";

type Gender = Database["public"]["Enums"]["gender"];
type Action = (state: StepState, form: FormData) => Promise<StepState>;
const IDLE: StepState = { status: "idle" };

function useStep(action: Action, formId: string) {
  const t = useTranslations("Onboarding.errors");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fields = state.status === "error" ? (state.fields ?? {}) : {};
  const error = (name: string) => (fields[name] ? t(fields[name] as "required") : undefined);
  const message = state.status === "error" && state.message ? t(state.message) : undefined;

  // Move focus to the first invalid field after a server response.
  useEffect(() => {
    if (state.status !== "error" || !state.fields) return;
    const first = Object.keys(state.fields)[0];
    const form = document.getElementById(formId);
    if (!first || !form) return;
    form
      .querySelector<HTMLElement>(`[name="${first}"]:not([type="hidden"]), [data-field="${first}"]`)
      ?.focus();
  }, [state, formId]);

  return { onSubmit: submitWithoutReset(formAction), formAction, pending, error, message };
}

function Submit({ pending, children }: { pending: boolean; children: ReactNode }) {
  const t = useTranslations("Auth");
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
      {pending ? t("submitting") : children}
    </Button>
  );
}

function Alert({ message }: { message?: string }) {
  return (
    <p role="alert" className="text-red-bright min-h-6 font-medium">
      {message}
    </p>
  );
}

const richLink = (href: string) =>
  function RichLink(chunks: ReactNode) {
    return (
      <Link href={href} target="_blank" className="text-accent underline underline-offset-2">
        {chunks}
      </Link>
    );
  };

function eighteenYearsAgo(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date.toISOString().slice(0, 10);
}

export function AgeStepForm({ birthdate }: { birthdate: string }) {
  const t = useTranslations("Onboarding");
  const step = useStep(saveAgeStep, "age-form");
  return (
    <form id="age-form" onSubmit={step.onSubmit} noValidate className="space-y-5">
      <p className="text-cream/85">{t("age.lead")}</p>
      <Input
        id="birthdate"
        name="birthdate"
        type="date"
        autoComplete="bday"
        max={eighteenYearsAgo()}
        defaultValue={birthdate}
        label={t("age.birthdate")}
        error={step.error("birthdate")}
      />
      <Checkbox id="attest" name="attest" label={t("age.attest")} error={step.error("attest")} />
      <Checkbox
        id="terms"
        name="terms"
        label={t.rich("age.terms", { terms: richLink("/cgu"), charter: richLink("/charte") })}
        error={step.error("terms")}
      />
      <Checkbox
        id="privacy"
        name="privacy"
        label={t.rich("age.privacy", { privacy: richLink("/confidentialite") })}
        error={step.error("privacy")}
      />
      <Submit pending={step.pending}>{t("next")}</Submit>
      <Alert message={step.message} />
    </form>
  );
}

export function IdentityStepForm({
  pseudo,
  gender,
  place,
}: {
  pseudo: string;
  gender: Gender | null;
  place: { id: number; label: string } | null;
}) {
  const t = useTranslations("Onboarding");
  const step = useStep(saveIdentityStep, "identity-form");
  const genderError = step.error("gender");
  return (
    <form id="identity-form" onSubmit={step.onSubmit} noValidate className="space-y-5">
      <p className="text-cream/85">{t("identity.lead")}</p>
      <Input
        id="pseudo"
        name="pseudo"
        autoComplete="nickname"
        maxLength={20}
        defaultValue={pseudo}
        label={t("identity.pseudo")}
        hint={t("identity.pseudoHint")}
        error={step.error("pseudo")}
      />
      <fieldset aria-describedby={genderError ? "gender-error" : undefined} className="space-y-2">
        <legend className="text-sm font-semibold">{t("identity.gender")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {Constants.public.Enums.gender.map((value) => (
            <label
              key={value}
              className="border-line has-checked:border-accent has-checked:bg-accent/10 has-focus-visible:outline-accent flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3.5 has-focus-visible:outline-3"
            >
              <input
                type="radio"
                name="gender"
                value={value}
                defaultChecked={gender === value}
                className="accent-accent size-5"
              />
              {t(`identity.genders.${value}`)}
            </label>
          ))}
        </div>
        {genderError ? (
          <p id="gender-error" role="alert" className="text-red-bright text-sm font-medium">
            {genderError}
          </p>
        ) : null}
      </fieldset>
      <CityPicker initial={place} error={step.error("placeId")} />
      <Submit pending={step.pending}>{t("next")}</Submit>
      <Alert message={step.message} />
    </form>
  );
}

/** Step 3, "Ton rôle": preselected by the door chosen on the landing (SPEC v7 §2 bis). */
export function RoleStepForm({ role }: { role: Role | null }) {
  const t = useTranslations("Onboarding");
  const step = useStep(saveRoleStep, "role-form");
  const roleError = step.error("role");
  return (
    <form id="role-form" onSubmit={step.onSubmit} noValidate className="space-y-5">
      <p className="text-cream/85">{t("role.lead")}</p>
      <fieldset aria-describedby={roleError ? "role-error" : undefined} className="space-y-3">
        <legend className="sr-only">{t("role.legend")}</legend>
        {ROLES.map((value) => (
          <label
            key={value}
            className="border-line has-checked:border-accent has-checked:bg-accent/10 has-focus-visible:outline-accent flex cursor-pointer gap-3 rounded-[var(--radius-card)] border p-4 has-focus-visible:outline-3"
          >
            <input
              type="radio"
              name="role"
              value={value}
              data-field="role"
              defaultChecked={role === value}
              className="accent-accent mt-1 size-5 shrink-0"
            />
            <span>
              <span className="font-display block text-2xl tracking-wide uppercase">
                {t(`role.${value}.title`)}
              </span>
              <span className="text-cream/85 mt-1 block">{t(`role.${value}.body`)}</span>
            </span>
          </label>
        ))}
        {roleError ? (
          <p id="role-error" role="alert" className="text-red-bright text-sm font-medium">
            {roleError}
          </p>
        ) : null}
      </fieldset>
      <p className="text-grey text-sm">{t("role.change")}</p>
      <Submit pending={step.pending}>{t("next")}</Submit>
      <Alert message={step.message} />
    </form>
  );
}

export function SeekingStepForm({
  role,
  genders,
  ageMin,
  ageMax,
  context = "onboarding",
}: {
  role: Role;
  genders: Gender[];
  ageMin: number;
  ageMax: number;
  /** « file »: « Mes critères » in Ma fiche (10d), same fields, same consent. */
  context?: "onboarding" | "file";
}) {
  const t = useTranslations("Onboarding");
  const step = useStep(saveSeekingStep, "seeking-form");
  const gendersError = step.error("genders");
  return (
    <form id="seeking-form" onSubmit={step.onSubmit} noValidate className="space-y-5">
      {context === "file" ? <input type="hidden" name="context" value="file" /> : null}
      <p className="text-cream/85">{t(`seeking.lead_${role}`)}</p>
      <fieldset
        aria-describedby={gendersError ? "genders-error" : "genders-hint"}
        className="space-y-2"
      >
        <legend className="text-sm font-semibold">{t(`seeking.genders_${role}`)}</legend>
        <p id="genders-hint" className="text-grey text-sm">
          {t("seeking.gendersHint")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {Constants.public.Enums.gender.map((value) => (
            <label
              key={value}
              className="border-line has-checked:border-accent has-checked:bg-accent/10 has-focus-visible:outline-accent flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3.5 has-focus-visible:outline-3"
            >
              <input
                type="checkbox"
                name="genders"
                value={value}
                defaultChecked={genders.includes(value)}
                className="accent-accent size-5"
              />
              {t(`identity.genders.${value}`)}
            </label>
          ))}
        </div>
        {gendersError ? (
          <p id="genders-error" role="alert" className="text-red-bright text-sm font-medium">
            {gendersError}
          </p>
        ) : null}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Input
          id="ageMin"
          name="ageMin"
          type="number"
          inputMode="numeric"
          min={18}
          max={99}
          defaultValue={ageMin}
          label={t("seeking.ageMin")}
          error={step.error("ageMin")}
        />
        <Input
          id="ageMax"
          name="ageMax"
          type="number"
          inputMode="numeric"
          min={18}
          max={99}
          defaultValue={ageMax}
          label={t("seeking.ageMax")}
          error={step.error("ageMax")}
        />
      </div>
      <section
        aria-labelledby="consent-title"
        className="border-accent/60 bg-accent/5 space-y-3 rounded-[var(--radius-card)] border p-4"
      >
        <h2 id="consent-title" className="font-display text-xl tracking-wide uppercase">
          {t("seeking.consentTitle")}
        </h2>
        <p className="text-sm">{t("seeking.consentText")}</p>
        {/* Explicit, separate and never pre-checked (GDPR art. 9). */}
        <Checkbox
          id="consent"
          name="consent"
          label={t("seeking.consent")}
          error={step.error("consent")}
        />
      </section>
      <Submit pending={step.pending}>{context === "file" ? t("save") : t("next")}</Submit>
      <Alert message={step.message} />
    </form>
  );
}

export function PhotoStepForm({ last }: { last: boolean }) {
  const t = useTranslations("Onboarding");
  const id = useId();
  const step = useStep(uploadPhotoAction, "photo-form");
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // « Déposer au Greffe » in the preview sends the photo: the form is submitted once it holds it.
  const [sendRequest, setSendRequest] = useState(0);
  useEffect(() => {
    if (sendRequest > 0) formRef.current?.requestSubmit();
  }, [sendRequest]);
  const [cutout, setCutout] = useState(false);
  const { choose, dialog } = useCutoutChoice(prepareForUpload);
  const engine = usePreloadCutout();
  const errorT = useTranslations("Onboarding.errors");
  const cutoutT = useTranslations("Onboarding.cutout");

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function onFile(file: File | undefined) {
    if (!file) return;
    setLocalError(undefined);
    setPreparing(true);
    try {
      // The preview on the wall, cut out on the device: « Déposer au Greffe » sends it.
      const choice = await choose(await prepareForUpload(file));
      if (!choice) return;
      setPhotoBlob(choice.blob);
      setCutout(choice.cutout);
      setPreview(URL.createObjectURL(choice.blob));
      setSendRequest((count) => count + 1);
    } catch {
      setPhotoBlob(null);
      setLocalError(errorT("photoUnreadable"));
    } finally {
      setPreparing(false);
    }
  }

  const photoError = localError ?? step.error("photo");

  return (
    <form
      id="photo-form"
      ref={formRef}
      data-cutout-engine={engine}
      noValidate
      onSubmit={submitWithoutReset(step.formAction, (form) => {
        form.delete("file");
        if (photoBlob) form.set("photo", photoBlob, "photo");
        form.set("position", "0");
        form.set("onboarding", "1");
      })}
      className="space-y-5"
    >
      <p className="text-cream/85">{t("photo.lead")}</p>
      <p className="text-grey text-sm">{t("photo.rules")}</p>
      <div className="relative mx-auto aspect-[4/5] w-full max-w-xs overflow-hidden rounded-[var(--radius-card)]">
        <Toise />
        {preview ? (
          <Mugshot src={preview} alt={t("photo.previewAlt")} cutout={cutout} fill />
        ) : (
          <div className="relative flex size-full items-center justify-center">
            <FramingGuide label={cutoutT("framing")} placard={cutoutT("placard")} />
            <ImagePlus aria-hidden="true" className="text-cream/40 -mt-[20%] size-16" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${id}-file`}
          className="border-cream/80 text-cream has-focus-visible:outline-accent hover:bg-cream hover:text-ink inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border-2 px-5 py-2 font-semibold has-focus-visible:outline-3"
        >
          {preview ? t("photo.change") : t("photo.choose")}
          <input
            id={`${id}-file`}
            name="file"
            data-field="photo"
            type="file"
            accept="image/*"
            className="sr-only"
            aria-invalid={photoError ? true : undefined}
            aria-describedby={photoError ? `${id}-error` : undefined}
            onChange={(event) => {
              // Read, then cleared: the same file may be chosen again after a cancel.
              const chosen = event.target.files?.[0];
              event.target.value = "";
              void onFile(chosen);
            }}
          />
        </label>
        <p aria-live="polite" className="text-grey min-h-6 text-center text-sm">
          {preparing ? t("photo.preparing") : step.pending ? t("photo.uploading") : ""}
        </p>
        {photoError ? (
          <p id={`${id}-error`} role="alert" className="text-red-bright text-sm font-medium">
            {photoError}
          </p>
        ) : null}
      </div>
      <Submit pending={step.pending || preparing}>{last ? t("finish") : t("next")}</Submit>
      <Alert message={step.message} />
      {dialog}
    </form>
  );
}

/** Visitor: the Motif de visite, read by the Bads before they accept a visit (SPEC v7 §5 bis). */
export function MotiveStepForm({ motive }: { motive: string }) {
  const t = useTranslations("Onboarding");
  const step = useStep(saveMotiveStep, "motive-form");
  return (
    <form id="motive-form" onSubmit={step.onSubmit} noValidate className="space-y-5">
      <p className="text-cream/85">{t("motive.lead")}</p>
      <Textarea
        id="motive"
        name="motive"
        rows={5}
        maxLength={VISIT_MOTIVE_MAX}
        defaultValue={motive}
        label={t("motive.label")}
        hint={t("motive.hint", { max: VISIT_MOTIVE_MAX })}
        error={step.error("motive")}
      />
      <Submit pending={step.pending}>{t("next")}</Submit>
      <Alert message={step.message} />
    </form>
  );
}

/** The true charge of the fictional practice Record (the 2nd one, LANDING-DESIGN.md §2.1). */
const PRACTICE_TRUE_INDEX = 1;

/**
 * Visitor step « Entraîne-toi »: a fictional Record to try the bet once. Purely local: the
 * answer is never sent; submitting (or « Passer ») only moves to the next step.
 */
export function PracticeStepForm() {
  const t = useTranslations("Onboarding.practice");
  const step = useStep(savePracticeStep, "practice-form");
  const charges = t.raw("charges") as string[];
  const [bet, setBet] = useState<number | null>(null);
  const answered = bet !== null;
  const right = bet === PRACTICE_TRUE_INDEX;

  return (
    <form id="practice-form" onSubmit={step.onSubmit} noValidate className="space-y-5">
      <div className="flex justify-end">
        <button
          type="submit"
          className="text-cream inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        >
          {t("skip")}
        </button>
      </div>
      <p className="text-cream/85 text-center">{t("lead")}</p>
      <section
        aria-labelledby="practice-case"
        className="paper space-y-3 overflow-x-clip rounded-[var(--radius-card)] p-4"
      >
        <h2
          id="practice-case"
          className="font-stamp text-grey-ink text-center text-sm tracking-[0.15em] uppercase"
        >
          {t("caseLabel")}
        </h2>
        {answered ? null : <p className="text-grey-ink text-center text-sm">{t("chooseHint")}</p>}
        <ol className="space-y-2.5">
          {charges.map((charge, index) => {
            const isTrue = index === PRACTICE_TRUE_INDEX;
            const isBet = index === bet;
            return (
              <li key={charge}>
                <button
                  type="button"
                  disabled={answered}
                  aria-pressed={isBet}
                  onClick={() => setBet(index)}
                  className={cn(
                    "font-stamp relative flex min-h-11 w-full items-start gap-3 rounded-md border-2 bg-white/70 px-3 py-2.5 text-left",
                    !answered && "border-paper-shade hover:border-accent-ink",
                    answered && isTrue && "border-green-ink",
                    answered && !isTrue && isBet && "border-red-ink",
                    answered && !isTrue && !isBet && "border-paper-shade opacity-70",
                  )}
                >
                  <span aria-hidden="true" className="text-red-ink">
                    {index + 1}
                  </span>
                  <span className="flex-1">{charge}</span>
                  {answered && isTrue ? (
                    <span className="bg-green-ink inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-sans text-xs font-bold text-white">
                      <Check aria-hidden="true" className="size-3.5" />
                      {t("trueLabel")}
                    </span>
                  ) : null}
                  {answered && isBet && !isTrue ? (
                    <span className="bg-red-ink inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-sans text-xs font-bold text-white">
                      <X aria-hidden="true" className="size-3.5" />
                      {t("yourBet")}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
        <div aria-live="polite" className="space-y-2 text-center">
          {answered ? (
            <>
              <Stamp
                kind={right ? "rightGuess" : "wrongGuess"}
                surface="paper"
                size="md"
                animated
                tilt={right ? -6 : 5}
              />
              <p className="text-sm">
                {right
                  ? t("revealRight")
                  : t("revealWrong", { charge: charges[PRACTICE_TRUE_INDEX] ?? "" })}
              </p>
            </>
          ) : null}
        </div>
      </section>
      <p className="border-line rounded-[var(--radius-card)] border border-dashed p-4 text-center text-sm">
        {t.rich("secretNote", { strong: (chunks) => <strong>{chunks}</strong> })}
      </p>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={step.pending}
        aria-busy={step.pending}
      >
        {t("cta")}
      </Button>
      <Alert message={step.message} />
    </form>
  );
}

/** « Terminer mon dossier » (10d): complete_onboarding() checks everything again in SQL. */
export function FinishDossierForm() {
  const t = useTranslations("Onboarding");
  const step = useStep(finishDossierAction, "finish-dossier");
  return (
    <form id="finish-dossier" action={step.formAction} className="space-y-3">
      <Submit pending={step.pending}>{t("dossier.finish")}</Submit>
      <Alert message={step.message} />
    </form>
  );
}
