import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { QuestionForm } from "@/components/interrogation/question-form";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { redirect } from "@/i18n/navigation";
import { requireMemberArea } from "@/lib/auth/user";
import { loadQuestions } from "@/lib/interrogation-server";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Interrogation" });
  return { title: t("title") };
}

export default async function InterrogationQuestionPage({ params }: Props) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const member = await requireMemberArea();
  const locale = await getLocale();
  const { data: profile } = await member.supabase
    .from("profiles")
    .select("onboarding_completed_at")
    .eq("id", member.userId)
    .maybeSingle();
  if (!profile?.onboarding_completed_at) return redirect({ href: "/onboarding", locale });
  const t = await getTranslations("Interrogation");
  const questions = await loadQuestions(member.supabase, member.userId, locale);
  const index = questions.findIndex((question) => question.id === id);
  const question = questions[index];
  if (!question) notFound();

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="text-accent font-stamp text-center text-sm tracking-[0.25em] uppercase">
        {t("kicker", { current: index + 1, total: questions.length })}
      </p>
      <h1 className="font-display mt-2 mb-6 text-center text-4xl tracking-wide uppercase">
        {question.label}
      </h1>
      <QuestionForm key={question.id} question={question} context="file" submitLabel={t("save")} />
      <p className="text-center">
        <LocalizedLink
          href="/interrogatoire"
          className="text-cream inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        >
          {t("backToList")}
        </LocalizedLink>
      </p>
    </div>
  );
}
