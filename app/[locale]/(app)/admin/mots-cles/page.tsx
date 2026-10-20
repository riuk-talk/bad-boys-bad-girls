import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { PilotageOutcome } from "@/components/admin/pilotage-outcome";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/user";
import { REPORT_CATEGORIES, type ReportCategory } from "@/lib/moderation";
import { saveKeywordAction } from "../pilotage-actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.keywords" });
  return { title: t("title") };
}

const field = "border-line bg-ink-2 min-h-11 w-full rounded-lg border px-3 py-2";

type Keyword = {
  id?: number;
  term: string;
  lang: string;
  category: ReportCategory;
  active: boolean;
};

async function KeywordForm({ keyword, id }: { keyword: Keyword; id: string }) {
  const t = await getTranslations("Admin");
  return (
    <form action={saveKeywordAction} className="grid items-end gap-3 sm:grid-cols-5">
      {keyword.id ? <input type="hidden" name="keyword" value={keyword.id} /> : null}
      <div className="space-y-1">
        <label htmlFor={`${id}-term`} className="text-sm font-semibold">
          {t("keywords.term")}
        </label>
        <input
          id={`${id}-term`}
          name="term"
          defaultValue={keyword.term}
          required
          maxLength={60}
          className={field}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-lang`} className="text-sm font-semibold">
          {t("keywords.lang")}
        </label>
        <select id={`${id}-lang`} name="lang" defaultValue={keyword.lang} className={field}>
          <option value="fr">{t("keywords.langFr")}</option>
          <option value="en">{t("keywords.langEn")}</option>
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-category`} className="text-sm font-semibold">
          {t("keywords.category")}
        </label>
        <select
          id={`${id}-category`}
          name="category"
          defaultValue={keyword.category}
          className={field}
        >
          {REPORT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(`categories.${category}`)}
            </option>
          ))}
        </select>
      </div>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" name="active" defaultChecked={keyword.active} />
        {t("keywords.active")}
      </label>
      <Button type="submit" variant="secondary">
        {keyword.id ? t("keywords.save") : t("keywords.create")}
      </Button>
    </form>
  );
}

/** Mots-clés de modération (SPEC §15): a text that contains one goes to « Textes signalés ». */
export default async function KeywordsPage({ searchParams }: Props) {
  const member = await requireMember();
  const { data: isAdmin } = await member.supabase.rpc("is_admin");
  if (isAdmin !== true) notFound();
  const t = await getTranslations("Admin.keywords");
  const { error, done } = await searchParams;
  const { data } = await member.supabase.rpc("admin_keywords");
  const keywords = data ?? [];
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("lead")}</p>
        <PilotageOutcome error={error} done={done} />
      </div>
      <section aria-labelledby="new-keyword" className="space-y-3">
        <h2 id="new-keyword" className="font-display text-2xl uppercase">
          {t("new")}
        </h2>
        <KeywordForm
          id="keyword-new"
          keyword={{ term: "", lang: "fr", category: "scam", active: true }}
        />
      </section>
      {keywords.length === 0 ? <p className="text-grey">{t("empty")}</p> : null}
      <ul className="divide-line divide-y">
        {keywords.map((keyword) => (
          <li key={keyword.keyword_id} className="py-3">
            <KeywordForm
              id={`keyword-${keyword.keyword_id}`}
              keyword={{
                id: keyword.keyword_id,
                term: keyword.term,
                lang: keyword.lang,
                category: keyword.category,
                active: keyword.is_active,
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
