import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import * as z from "zod/mini";
import { PilotageOutcome } from "@/components/admin/pilotage-outcome";
import { Button } from "@/components/ui/button";
import { requireAdminPermission } from "@/lib/admin/guard";
import { saveQuestionAction } from "../pilotage-actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.questions" });
  return { title: t("title") };
}

const field = "border-line bg-ink-2 min-h-11 w-full rounded-lg border px-3 py-2";
const optionsSchema = z.array(z.object({ id: z.number(), fr: z.string(), en: z.string() }));

/**
 * Questions de l'Interrogatoire (SPEC §9, §15): wording only (FR/EN, options included), so the
 * answers keep their meaning; only an « extra » question can be deactivated.
 */
export default async function QuestionsPage({ searchParams }: Props) {
  const member = await requireAdminPermission("questions.edit");
  const t = await getTranslations("Admin.questions");
  const { error, done } = await searchParams;
  const { data } = await member.supabase.rpc("admin_questions");
  const questions = data ?? [];
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("lead")}</p>
        <PilotageOutcome error={error} done={done} />
      </div>
      <ul className="space-y-4">
        {questions.map((question) => {
          const options = optionsSchema.safeParse(question.options);
          const id = `question-${question.question_id}`;
          return (
            <li
              key={question.question_id}
              className="border-line rounded-lg border bg-[#121214] p-4"
            >
              <details>
                <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                  {question.sort_position}. {question.label_fr}{" "}
                  <span className="text-grey text-sm font-normal">
                    {t(`phase_${question.phase}`)} ·{" "}
                    {question.is_active ? t("active") : t("inactive")} ·{" "}
                    {t("answers", { count: question.answers })}
                  </span>
                </summary>
                <form action={saveQuestionAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="question" value={question.question_id} />
                  <div className="space-y-1">
                    <label htmlFor={`${id}-fr`} className="text-sm font-semibold">
                      {t("labelFr")}
                    </label>
                    <input
                      id={`${id}-fr`}
                      name="fr"
                      defaultValue={question.label_fr}
                      required
                      maxLength={200}
                      className={field}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={`${id}-en`} className="text-sm font-semibold">
                      {t("labelEn")}
                    </label>
                    <input
                      id={`${id}-en`}
                      name="en"
                      defaultValue={question.label_en}
                      required
                      maxLength={200}
                      className={field}
                    />
                  </div>
                  {(options.success ? options.data : []).map((option, index) => (
                    <fieldset key={option.id} className="space-y-1 sm:col-span-2">
                      <legend className="text-sm font-semibold">
                        {t("option", { number: index + 1 })}
                      </legend>
                      <input type="hidden" name="optionId" value={option.id} />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          name={`optionFr-${option.id}`}
                          aria-label={t("optionFr", { number: index + 1 })}
                          defaultValue={option.fr}
                          required
                          maxLength={120}
                          className={field}
                        />
                        <input
                          name={`optionEn-${option.id}`}
                          aria-label={t("optionEn", { number: index + 1 })}
                          defaultValue={option.en}
                          required
                          maxLength={120}
                          className={field}
                        />
                      </div>
                    </fieldset>
                  ))}
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      name="active"
                      defaultChecked={question.is_active}
                      disabled={question.phase === "core"}
                    />
                    {question.phase === "core" ? t("coreActive") : t("active")}
                  </label>
                  {question.phase === "core" ? (
                    <input type="hidden" name="active" value="on" />
                  ) : null}
                  <Button type="submit" variant="secondary">
                    {t("save")}
                  </Button>
                </form>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
