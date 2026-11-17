import { Check } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { redirect } from "@/i18n/navigation";
import { requireMemberArea } from "@/lib/auth/user";
import { loadQuestions } from "@/lib/interrogation-server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Interrogation" });
  return { title: t("title") };
}

/** L'Interrogatoire after the onboarding: the 10 core answers can be edited, the 10 others added. */
export default async function InterrogationPage() {
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
  const answered = questions.filter((question) => question.answer).length;

  return (
    <div className="mx-auto max-w-xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85">{t("lead")}</p>
        <p className="text-accent font-semibold">
          {t("count", { answered, total: questions.length })}
        </p>
      </div>
      {(["core", "extra"] as const).map((phase) => (
        <section key={phase} aria-labelledby={`phase-${phase}`} className="space-y-3">
          <h2 id={`phase-${phase}`} className="font-display text-2xl tracking-wide uppercase">
            {t(phase)}
          </h2>
          <ul className="divide-line border-line divide-y rounded-lg border">
            {questions
              .filter((question) => question.phase === phase)
              .map((question) => (
                <li key={question.id}>
                  <LocalizedLink
                    href={`/interrogatoire/${question.id}`}
                    className="hover:bg-ink-2 flex min-h-14 items-center justify-between gap-3 px-4 py-3 no-underline"
                  >
                    <span className="font-semibold">{question.label}</span>
                    <span className="text-sm whitespace-nowrap">
                      {question.answer ? (
                        <span className="text-green-bright inline-flex items-center gap-1">
                          <Check aria-hidden="true" className="size-4" />
                          {t("answered")}
                        </span>
                      ) : (
                        <span className="text-grey">{t("todo")}</span>
                      )}
                    </span>
                  </LocalizedLink>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
