import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/user";
import { VITAL_GOOD, VITAL_METRICS, VITAL_PAGES, type VitalMetric } from "@/lib/vitals";

type Props = { params: Promise<{ locale: string }> };

const DAYS = 28;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.vitals" });
  return { title: t("title") };
}

/** Performance réelle (SPEC §18): 75th percentile of the real Core Web Vitals, per page. */
export default async function PerformancePage() {
  const member = await requireMember();
  const { data: isAdmin } = await member.supabase.rpc("is_admin");
  if (isAdmin !== true) notFound();
  const t = await getTranslations("Admin.vitals");
  const format = await getFormatter();
  const { data } = await member.supabase.rpc("admin_web_vitals", { p_days: DAYS });
  const rows = data ?? [];
  const cell = (page: string, metric: VitalMetric) =>
    rows.find((row) => row.page === page && row.metric === metric);
  const pages = VITAL_PAGES.filter((page) => rows.some((row) => row.page === page));
  const shown = (metric: VitalMetric, value: number) =>
    metric === "CLS"
      ? format.number(value, { maximumFractionDigits: 2 })
      : `${format.number(Math.round(value))} ms`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
      <p className="text-grey">{t("intro", { days: DAYS })}</p>
      {pages.length === 0 ? (
        <p className="text-grey">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-line border-b">
                <th scope="col" className="py-2 pr-4">
                  {t("page")}
                </th>
                {VITAL_METRICS.map((metric) => (
                  <th key={metric} scope="col" className="py-2 pr-4">
                    {metric}
                    <span className="text-grey block font-normal">
                      {t("target", { value: shown(metric, VITAL_GOOD[metric]) })}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {pages.map((page) => (
                <tr key={page}>
                  <th scope="row" className="py-2 pr-4 font-semibold">
                    {t(`pages.${page}`)}
                  </th>
                  {VITAL_METRICS.map((metric) => {
                    const row = cell(page, metric);
                    if (!row || row.p75 === null) {
                      return (
                        <td key={metric} className="text-grey py-2 pr-4">
                          —
                        </td>
                      );
                    }
                    const good = row.p75 < VITAL_GOOD[metric];
                    return (
                      <td key={metric} className="py-2 pr-4">
                        <span className="font-semibold">{shown(metric, row.p75)}</span>{" "}
                        <span>({good ? t("good") : t("bad")})</span>
                        <span className="text-grey block">
                          {t("samples", { count: format.number(row.samples) })}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
