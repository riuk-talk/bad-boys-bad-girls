"use client";

import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";
import { saveAnswerAction, type StepState } from "@/app/[locale]/(app)/onboarding/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { submitWithoutReset } from "@/lib/forms/submit";
import { DEFAULT_IMPORTANCE, IMPORTANCES, type QuestionView } from "@/lib/interrogation";

const IDLE: StepState = { status: "idle" };

/**
 * One question of L'Interrogatoire (maquette QCM.dc.html): the answer in one tap, « Affiner »
 * (accepted answers and importance) folded in a native <details>, defaults otherwise.
 */
export function QuestionForm({
  question,
  context,
  submitLabel,
}: {
  question: QuestionView;
  context: "onboarding" | "file";
  submitLabel: string;
}) {
  const t = useTranslations("Interrogation");
  const errorT = useTranslations("Onboarding.errors");
  const id = useId();
  const [state, formAction, pending] = useActionState(saveAnswerAction, IDLE);
  const [chosen, setChosen] = useState<number | null>(question.answer?.optionId ?? null);
  const accepted = question.answer?.accepted ?? question.options.map((option) => option.id);
  const importance = question.answer?.importance ?? DEFAULT_IMPORTANCE;
  const fields = state.status === "error" ? (state.fields ?? {}) : {};
  const answerError = fields.optionId ? errorT(fields.optionId as "answerRequired") : undefined;
  const acceptedError = fields.accepted ? errorT(fields.accepted as "acceptedRequired") : undefined;
  const message = state.status === "error" && state.message ? errorT(state.message) : undefined;

  return (
    <form
      key={question.id}
      onSubmit={submitWithoutReset(formAction)}
      noValidate
      className="space-y-5"
    >
      <input type="hidden" name="questionId" value={question.id} />
      <input type="hidden" name="context" value={context} />
      <fieldset
        aria-describedby={answerError ? `${id}-answer-error` : undefined}
        className="space-y-3"
      >
        <legend className="sr-only">{question.label}</legend>
        {question.options.map((option) => (
          <label
            key={option.id}
            className="border-line has-checked:border-accent has-checked:bg-accent/10 has-focus-visible:outline-accent flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-lg border-2 bg-[#141416] px-4 py-3 text-lg font-bold has-focus-visible:outline-3"
          >
            <input
              type="radio"
              name="optionId"
              value={option.id}
              defaultChecked={chosen === option.id}
              onChange={() => setChosen(option.id)}
              className="sr-only"
            />
            <span>{option.label}</span>
            {chosen === option.id ? (
              <Check aria-hidden="true" className="text-accent size-6 shrink-0" />
            ) : null}
          </label>
        ))}
        {answerError ? (
          <p id={`${id}-answer-error`} role="alert" className="text-red-bright text-sm font-medium">
            {answerError}
          </p>
        ) : null}
      </fieldset>

      <details
        className="group border-line rounded-lg border bg-[#121214] px-4 py-3"
        open={Boolean(acceptedError) || undefined}
      >
        <summary className="text-accent flex min-h-11 cursor-pointer list-none items-center justify-between text-lg uppercase [&::-webkit-details-marker]:hidden">
          {t("refine")}
          <ChevronDown
            aria-hidden="true"
            className="size-5 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="space-y-4 pt-2 pb-1">
          <fieldset
            className="space-y-2"
            aria-describedby={acceptedError ? `${id}-accepted-error` : `${id}-accepted-hint`}
          >
            <legend className="text-cream/85 text-sm">{t("accepted")}</legend>
            <p id={`${id}-accepted-hint`} className="sr-only">
              {t("acceptedHint")}
            </p>
            <div className="flex flex-wrap gap-2">
              {question.options.map((option) => (
                <label
                  key={option.id}
                  className="border-accent/70 has-checked:bg-accent has-checked:text-ink has-focus-visible:outline-accent inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-semibold has-focus-visible:outline-3"
                >
                  <input
                    type="checkbox"
                    name="accepted"
                    value={option.id}
                    defaultChecked={accepted.includes(option.id)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {acceptedError ? (
              <p
                id={`${id}-accepted-error`}
                role="alert"
                className="text-red-bright text-sm font-medium"
              >
                {acceptedError}
              </p>
            ) : null}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-cream/85 text-sm">{t("importance")}</legend>
            <div className="border-line grid grid-cols-3 overflow-hidden rounded-md border">
              {IMPORTANCES.map((value) => (
                <label
                  key={value}
                  className={cn(
                    "has-checked:bg-accent has-checked:text-ink has-focus-visible:outline-accent flex min-h-12 cursor-pointer items-center justify-center px-1 text-center text-sm font-bold has-focus-visible:outline-3 has-focus-visible:-outline-offset-3",
                    value !== "low" && "border-line border-l",
                  )}
                >
                  <input
                    type="radio"
                    name="importance"
                    value={value}
                    defaultChecked={importance === value}
                    className="sr-only"
                  />
                  {t(`importance_${value}`)}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>

      <p className="text-grey text-center text-sm">{t("privacy")}</p>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending ? t("saving") : submitLabel}
      </Button>
      <p role="alert" className="text-red-bright min-h-6 font-medium">
        {message}
      </p>
    </form>
  );
}
