import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Importance } from "@/lib/complicity";
import { localized, type QuestionView } from "@/lib/interrogation";
import type { Database } from "@/lib/supabase/database.types";

type Phase = Database["public"]["Enums"]["question_phase"];

/** Active questions (RLS: active only), their options and the member's own answers, in order. */
export async function loadQuestions(
  supabase: SupabaseClient<Database>,
  userId: string,
  locale: string,
  phase?: Phase,
): Promise<(QuestionView & { phase: Phase })[]> {
  let query = supabase.from("questions").select("id, position, phase, label").order("position");
  if (phase) query = query.eq("phase", phase);
  const [{ data: questions }, { data: options }, { data: answers }] = await Promise.all([
    query,
    supabase.from("question_options").select("id, question_id, position, label").order("position"),
    supabase
      .from("answers")
      .select("question_id, option_id, accepted_option_ids, importance")
      .eq("user_id", userId),
  ]);
  return (questions ?? []).map((question) => {
    const answer = answers?.find((row) => row.question_id === question.id);
    return {
      id: question.id,
      phase: question.phase,
      label: localized(question.label, locale),
      options: (options ?? [])
        .filter((option) => option.question_id === question.id)
        .map((option) => ({ id: option.id, label: localized(option.label, locale) })),
      answer: answer
        ? {
            optionId: answer.option_id,
            accepted: answer.accepted_option_ids,
            importance: answer.importance as Importance,
          }
        : null,
    };
  });
}
