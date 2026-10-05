import * as z from "zod/mini";
import type { Importance } from "@/lib/complicity";

/** L'Interrogatoire (SPEC v7.4 §9): one question per screen, « Affiner » folded. */
export const IMPORTANCES = ["low", "important", "essential"] as const satisfies readonly Importance[];
export const DEFAULT_IMPORTANCE: Importance = "important";

/** Error messages are i18n keys under "Interrogation.errors". */
export type AnswerErrorKey = "answerRequired" | "acceptedRequired" | "generic";

export const answerSchema = z.object({
  questionId: z.coerce.number().check(z.int(), z.positive()),
  optionId: z.coerce.number("answerRequired").check(z.int("answerRequired"), z.positive("answerRequired")),
  accepted: z
    .array(z.coerce.number().check(z.int(), z.positive()))
    .check(z.minLength(1, "acceptedRequired")),
  importance: z.enum(IMPORTANCES),
});
export type AnswerInput = z.infer<typeof answerSchema>;

/** Accepting every option is the default « toutes » (stored as null by the database too). */
export function acceptedForStorage(accepted: readonly number[], allOptionIds: readonly number[]) {
  const unique = [...new Set(accepted)].sort((a, b) => a - b);
  return unique.length === new Set(allOptionIds).size ? null : unique;
}

export type Localized = { fr?: string; en?: string };
export function localized(label: unknown, locale: string): string {
  const value = (label ?? {}) as Localized;
  return (locale === "en" ? value.en : value.fr) ?? value.fr ?? "";
}

export type QuestionView = {
  id: number;
  label: string;
  options: { id: number; label: string }[];
  answer: { optionId: number; accepted: number[] | null; importance: Importance } | null;
};
