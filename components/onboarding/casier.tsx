"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  confirmCasierStep,
  saveCasierStep,
  type StepState,
} from "@/app/[locale]/(app)/onboarding/actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { submitWithoutReset } from "@/lib/forms/submit";
import {
  balance,
  CHARGE_MAX,
  CHARGE_SHORT_ADVICE,
  chargeLength,
  duplicateIndexes,
} from "@/lib/casier";

const IDLE: StepState = { status: "idle" };
const THEMES = ["travel", "night", "moto", "love", "childhood", "work", "mischief"] as const;
type Theme = (typeof THEMES)[number];
const STAGES = [1, 2, 3] as const;

/**
 * Bad, step 6 « Le Casier » (SPEC §6, maquette Main.dc.html): the true line first, then two
 * believable false ones; a bank of prompts per theme, « Autre idée », free writing always possible.
 */
export function CasierStepForm({
  initial,
  context,
}: {
  /** [true, false, false] when the Casier already exists. */
  initial: [string, string, string];
  context: "onboarding" | "file";
}) {
  const t = useTranslations("Onboarding.casier");
  const errorT = useTranslations("Onboarding.errors");
  const prompts = t.raw("prompts") as Record<Theme, string[]>;
  const [state, formAction, pending] = useActionState(saveCasierStep, IDLE);
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [lines, setLines] = useState<[string, string, string]>(initial);
  const [theme, setTheme] = useState<Theme>("travel");
  const [promptIndex, setPromptIndex] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);

  const fields = state.status === "error" ? (state.fields ?? {}) : {};
  const serverError = (n: number) =>
    fields[`charge${n}`] ? errorT(fields[`charge${n}`] as "chargeRequired") : undefined;
  // Show the first stage the server refused (adjusted while rendering, once per new answer).
  const [answered, setAnswered] = useState(state);
  if (state !== answered) {
    setAnswered(state);
    const first = STAGES.find((n) => fields[`charge${n}`]);
    if (first) setStage(first);
  }
  useEffect(() => area.current?.focus(), [stage]);

  const current = lines[stage - 1] ?? "";
  const length = chargeLength(current);
  const duplicates = duplicateIndexes(lines);
  const localError =
    length > CHARGE_MAX
      ? errorT("chargeTooLong")
      : duplicates.includes(stage - 1) && length > 0
        ? errorT("chargesDuplicate")
        : undefined;
  const error = localError ?? serverError(stage);
  const prompt = prompts[theme][promptIndex % prompts[theme].length] ?? "";
  const message = state.status === "error" && state.message ? errorT(state.message) : undefined;

  function setLine(value: string) {
    setLines((previous) => {
      const next = [...previous] as [string, string, string];
      next[stage - 1] = value;
      return next;
    });
  }

  return (
    <form onSubmit={submitWithoutReset(formAction)} noValidate className="space-y-5">
      <input type="hidden" name="context" value={context} />
      {lines.map((line, index) => (
        <input key={index} type="hidden" name={`charge${index + 1}`} value={line} />
      ))}
      <p className="text-cream/85 text-center">{t("lead")}</p>

      <ol aria-label={t("stagesLabel")} className="flex justify-center gap-2">
        {STAGES.map((n) => (
          <li key={n}>
            <button
              type="button"
              onClick={() => setStage(n)}
              aria-current={stage === n ? "step" : undefined}
              className={cn(
                "font-stamp min-h-11 rounded-full border px-3 text-xs tracking-[0.1em] uppercase",
                stage === n ? "bg-accent text-ink border-accent" : "border-line text-cream/85",
              )}
            >
              {t(`stage_${n}`)}
            </button>
          </li>
        ))}
      </ol>

      <fieldset className="space-y-3">
        <legend className="text-cream/85 text-sm font-semibold">{t("themesLabel")}</legend>
        <div className="flex flex-wrap gap-2">
          {THEMES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={theme === value}
              onClick={() => {
                setTheme(value);
                setPromptIndex(0);
              }}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm font-bold",
                theme === value ? "bg-accent text-ink border-accent" : "border-line",
              )}
            >
              {t(`themes.${value}`)}
            </button>
          ))}
        </div>
        <div className="border-line flex items-center gap-3 rounded-lg border border-dashed p-3.5">
          <p className="font-stamp flex-1" aria-live="polite">
            <span className="sr-only">{t("promptLabel")} </span>
            {prompt}
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setPromptIndex((index) => index + 1)}
              className="border-accent text-accent min-h-11 rounded-md border px-3 text-sm font-bold"
            >
              {t("otherIdea")}
            </button>
            <button
              type="button"
              onClick={() => {
                setLine(prompt);
                area.current?.focus();
              }}
              className="text-cream min-h-11 px-3 text-sm font-semibold underline underline-offset-4"
            >
              {t("useIdea")}
            </button>
          </div>
        </div>
      </fieldset>

      <div className="paper space-y-2 rounded-lg p-4">
        <label
          htmlFor={`charge-${stage}`}
          className="font-stamp text-grey-ink block text-xs tracking-[0.15em] uppercase"
        >
          {t(`label_${stage}`)}
        </label>
        <textarea
          ref={area}
          id={`charge-${stage}`}
          data-field={`charge${stage}`}
          rows={3}
          value={current}
          onChange={(event) => setLine(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={`charge-${stage}-hint charge-${stage}-count${error ? ` charge-${stage}-error` : ""}`}
          className="font-stamp border-paper-shade w-full rounded-md border-2 bg-white/80 p-3 text-lg text-ink focus:border-[#34343b] focus:outline-none"
        />
        <div className="flex justify-between gap-3 text-xs text-[#4a4038]">
          <span id={`charge-${stage}-hint`}>{stage === 1 ? t("hint_1") : t("hint_false")}</span>
          <span id={`charge-${stage}-count`}>{t("count", { count: length })}</span>
        </div>
        {length > 0 && length < CHARGE_SHORT_ADVICE ? (
          <p className="text-xs font-semibold text-[#4a4038]">{t("tooShort")}</p>
        ) : null}
        {error ? (
          <p id={`charge-${stage}-error`} role="alert" className="text-red-ink text-sm font-bold">
            {error}
          </p>
        ) : null}
      </div>
      <p className="text-grey text-center text-sm">{t("forbidden")}</p>

      {stage < 3 ? (
        // Distinct keys: React must not turn this very button into the submit one during the click.
        <Button
          key="next"
          type="button"
          size="lg"
          className="w-full"
          disabled={length === 0 || Boolean(localError)}
          onClick={() => setStage((stage + 1) as 2 | 3)}
        >
          {t(`next_${stage}` as "next_1")}
        </Button>
      ) : (
        <Button key="submit" type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
          {t("submit")}
        </Button>
      )}
      <p role="alert" className="text-red-bright min-h-6 font-medium">
        {message}
      </p>
    </form>
  );
}

/**
 * Bad, step 7 « Teste ton Casier » (LANDING-DESIGN §2.2): the Casier as a Visitor sees it, the
 * true line labelled for its author only, the Souffleur's tips and the length balance (± 40 %).
 */
export function CasierCheck({
  charges,
  trueIndex,
  caseNumber,
  reworkHref,
  context,
}: {
  charges: [string, string, string];
  trueIndex: number;
  caseNumber: string;
  reworkHref: string;
  context: "onboarding" | "file";
}) {
  const t = useTranslations("Onboarding.casierCheck");
  const errorT = useTranslations("Onboarding.errors");
  const [state, formAction, pending] = useActionState(confirmCasierStep, IDLE);
  const warnings = balance(charges);
  const message = state.status === "error" && state.message ? errorT(state.message) : undefined;
  return (
    <div className="space-y-5">
      <p className="text-cream/85 text-center">{t("lead")}</p>
      <section aria-labelledby="casier-check" className="paper space-y-3 rounded-lg p-4">
        <h2
          id="casier-check"
          className="font-stamp text-grey-ink text-center text-sm tracking-[0.15em] uppercase"
        >
          {t("caseLabel", { number: caseNumber })}
        </h2>
        <ol className="space-y-2.5">
          {charges.map((charge, index) => {
            const isTrue = index + 1 === trueIndex;
            const warning = warnings[index];
            return (
              <li
                key={charge}
                className={cn(
                  "font-stamp rounded-md border-2 bg-white/70 px-3 py-2.5",
                  isTrue ? "border-green-ink" : "border-paper-shade",
                )}
              >
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="text-accent-ink">
                    {index + 1}
                  </span>
                  <span className="flex-1">{charge}</span>
                  {isTrue ? (
                    <span className="bg-green-ink inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-sans text-xs font-bold text-white">
                      <Check aria-hidden="true" className="size-3.5" />
                      {t("trueLabel")}
                    </span>
                  ) : null}
                </div>
                {warning ? (
                  <p className="text-red-ink mt-1.5 flex items-start gap-1.5 font-sans text-xs font-bold">
                    <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                    {t(warning)}
                  </p>
                ) : chargeLength(charge) < CHARGE_SHORT_ADVICE ? (
                  <p className="mt-1.5 font-sans text-xs font-semibold text-[#4a4038]">{t("shortLine")}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>
      <section aria-labelledby="souffleur-tips" className="border-line space-y-2 rounded-lg border bg-[#121214] p-4">
        <h2 id="souffleur-tips" className="text-accent text-lg uppercase">
          {t("tipsTitle")}
        </h2>
        <ul className="list-inside list-disc space-y-1 text-sm">
          {(t.raw("tips") as string[]).map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </section>
      <div className="flex flex-col gap-2.5">
        {context === "onboarding" ? (
          <form action={formAction}>
            <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
              {t("ready")}
            </Button>
          </form>
        ) : (
          <Link href="/ma-fiche" className={buttonClasses("primary", "lg", "w-full")}>
            {t("ready")}
          </Link>
        )}
        <Link href={reworkHref} className={buttonClasses("secondary", "lg", "w-full")}>
          {t("rework")}
        </Link>
      </div>
      <p role="alert" className="text-red-bright min-h-6 font-medium">
        {message}
      </p>
    </div>
  );
}
