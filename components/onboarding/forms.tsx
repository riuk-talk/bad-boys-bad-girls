"use client";

import { ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useId, useState, type ReactNode } from "react";
import {
  saveAgeStep,
  saveIdentityStep,
  saveSeekingStep,
  uploadPhotoAction,
  type StepState,
} from "@/app/[locale]/(app)/onboarding/actions";
import { Toise } from "@/components/brand/toise";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { submitWithoutReset } from "@/lib/forms/submit";
import { Constants, type Database } from "@/lib/supabase/database.types";
import { CityPicker } from "./city-picker";

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
      <Link href={href} target="_blank" className="text-gold underline underline-offset-2">
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
              className="border-line has-checked:border-gold has-checked:bg-gold/10 has-focus-visible:outline-gold flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3.5 has-focus-visible:outline-3"
            >
              <input
                type="radio"
                name="gender"
                value={value}
                defaultChecked={gender === value}
                className="accent-gold size-5"
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

export function SeekingStepForm({
  genders,
  ageMin,
  ageMax,
}: {
  genders: Gender[];
  ageMin: number;
  ageMax: number;
}) {
  const t = useTranslations("Onboarding");
  const step = useStep(saveSeekingStep, "seeking-form");
  const gendersError = step.error("genders");
  return (
    <form id="seeking-form" onSubmit={step.onSubmit} noValidate className="space-y-5">
      <p className="text-cream/85">{t("seeking.lead")}</p>
      <fieldset
        aria-describedby={gendersError ? "genders-error" : "genders-hint"}
        className="space-y-2"
      >
        <legend className="text-sm font-semibold">{t("seeking.genders")}</legend>
        <p id="genders-hint" className="text-grey text-sm">
          {t("seeking.gendersHint")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {Constants.public.Enums.gender.map((value) => (
            <label
              key={value}
              className="border-line has-checked:border-gold has-checked:bg-gold/10 has-focus-visible:outline-gold flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3.5 has-focus-visible:outline-3"
            >
              <input
                type="checkbox"
                name="genders"
                value={value}
                defaultChecked={genders.includes(value)}
                className="accent-gold size-5"
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
        className="border-gold/60 bg-gold/5 space-y-3 rounded-[var(--radius-card)] border p-4"
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
      <Submit pending={step.pending}>{t("next")}</Submit>
      <Alert message={step.message} />
    </form>
  );
}

export function PhotoStepForm() {
  const t = useTranslations("Onboarding");
  const id = useId();
  const step = useStep(uploadPhotoAction, "photo-form");
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const errorT = useTranslations("Onboarding.errors");

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
      const { compressForUpload } = await import("@/lib/image/compress");
      const blob = await compressForUpload(file);
      setPhotoBlob(blob);
      setPreview(URL.createObjectURL(blob));
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
      noValidate
      onSubmit={submitWithoutReset(step.formAction, (form) => {
        form.delete("file");
        if (photoBlob) form.set("photo", photoBlob, "photo");
        form.set("position", "0");
        form.set("finish", "1");
      })}
      className="space-y-5"
    >
      <p className="text-cream/85">{t("photo.lead")}</p>
      <p className="text-grey text-sm">{t("photo.rules")}</p>
      <div className="relative mx-auto aspect-[4/5] w-full max-w-xs overflow-hidden rounded-[var(--radius-card)]">
        <Toise />
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob preview, never optimised
          <img
            src={preview}
            alt={t("photo.previewAlt")}
            className="relative size-full object-cover"
          />
        ) : (
          <div className="relative flex size-full items-center justify-center">
            <ImagePlus aria-hidden="true" className="text-cream/40 size-16" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${id}-file`}
          className="border-cream/80 text-cream has-focus-visible:outline-gold hover:bg-cream hover:text-ink inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border-2 px-5 py-2 font-semibold has-focus-visible:outline-3"
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
            onChange={(event) => void onFile(event.target.files?.[0])}
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
      <Submit pending={step.pending || preparing}>{t("finish")}</Submit>
      <Alert message={step.message} />
    </form>
  );
}
