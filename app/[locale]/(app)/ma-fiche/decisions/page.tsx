import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/auth/user";
import { decisionsSchema } from "@/lib/moderation";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Decisions" });
  return { title: t("title") };
}

/**
 * Décisions du Greffe (SPEC §10 DSA): the exposé des motifs. The outcome of my reports with the
 * motive written for me (never the sanction of the other), and the decisions about me with their
 * motive (never who reported).
 */
export default async function DecisionsPage() {
  const { supabase } = await requireMember();
  const t = await getTranslations("Decisions");
  const format = await getFormatter();
  const [{ data }] = await Promise.all([
    supabase.rpc("get_my_decisions"),
    supabase.rpc("mark_notifications_read", { p_types: ["sanction", "report_decided"] }),
  ]);
  const parsed = decisionsSchema.safeParse(data);
  const { reports, decisions } = parsed.success ? parsed.data : { reports: [], decisions: [] };
  const when = (value: string) => format.dateTime(new Date(value), { dateStyle: "long" });

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85">{t("lead")}</p>
      </div>

      <section aria-labelledby="about-me" className="space-y-3">
        <h2 id="about-me" className="font-display text-2xl tracking-wide uppercase">
          {t("aboutMe")}
        </h2>
        {decisions.length === 0 ? <p className="text-grey">{t("noDecisions")}</p> : null}
        <ul className="space-y-3">
          {decisions.map((decision) => (
            <li key={decision.id} className="border-line bg-ink-2 space-y-1 rounded-lg border p-4">
              <p className="font-semibold">
                {t(`actions.${decision.action}`)}{" "}
                <span className="text-grey text-sm font-normal">{when(decision.created_at)}</span>
              </p>
              {decision.ends_at ? (
                <p className="text-sm">{t("until", { date: when(decision.ends_at) })}</p>
              ) : null}
              {decision.reason ? (
                <p className="text-sm whitespace-pre-wrap">
                  <span className="text-grey">{t("motive")} </span>
                  {decision.reason}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="my-reports" className="space-y-3">
        <h2 id="my-reports" className="font-display text-2xl tracking-wide uppercase">
          {t("myReports")}
        </h2>
        {reports.length === 0 ? <p className="text-grey">{t("noReports")}</p> : null}
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report.id} className="border-line bg-ink-2 space-y-1 rounded-lg border p-4">
              <p className="font-semibold">
                {t(`categories.${report.category}`)}{" "}
                <span className="text-grey text-sm font-normal">{when(report.created_at)}</span>
              </p>
              <p className="text-sm">{t(`statuses.${report.status}`)}</p>
              {report.reason ? (
                <p className="text-sm whitespace-pre-wrap">
                  <span className="text-grey">{t("motive")} </span>
                  {report.reason}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <p className="text-grey text-sm">{t("contact")}</p>
    </div>
  );
}
