import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Outcome } from "@/components/admin/outcome";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { adminCan, requireAdminPermission } from "@/lib/admin/guard";
import { MOTIVE_MAX, MOTIVE_MIN, REPORT_SANCTIONS, SUSPENSION_DAYS_MAX } from "@/lib/moderation";
import { decideReportAction } from "../moderation-actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.reports" });
  return { title: t("title") };
}

const field = "border-line bg-ink-2 w-full rounded-lg border px-3 py-2";

/**
 * File des signalements (SPEC §10 DSA, §15): « mineur » first. One decision per report, with a
 * motive for the reporter and, when upheld, a sanction and a motive for the member concerned.
 */
export default async function ReportsPage({ searchParams }: Props) {
  const member = await requireAdminPermission("reports.decide");
  // Upholding a report sanctions its target: that needs sanctions.apply too (10f).
  const canSanction = await adminCan(member, "sanctions.apply");
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const { error, done } = await searchParams;
  const { data } = await member.supabase.rpc("admin_report_queue", { p_limit: 50 });
  const rows = data ?? [];
  const photoUrl = (path: string | null) =>
    path ? member.supabase.storage.from("photos").getPublicUrl(path).data.publicUrl : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("reports.title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("reports.lead")}</p>
        <p className="text-accent font-semibold" role="status">
          {t("reports.waiting", { count: rows.length })}
        </p>
        <Outcome error={error} done={done} />
      </div>
      {rows.length === 0 ? <p className="text-grey">{t("reports.empty")}</p> : null}
      <ul className="space-y-5">
        {rows.map((row) => {
          const url = photoUrl(row.photo_path);
          const id = `report-${row.report_id}`;
          return (
            <li
              key={row.report_id}
              className="border-line space-y-3 rounded-lg border bg-[#121214] p-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className={
                    row.category === "minor"
                      ? "bg-red-bright text-ink rounded-full px-2.5 py-0.5 text-sm font-bold"
                      : "text-accent font-bold"
                  }
                >
                  {t(`categories.${row.category}`)}
                </span>
                <span className="text-grey text-sm">
                  {t(`targets.${row.target_type}`)} ·{" "}
                  {format.dateTime(new Date(row.created_at), {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              <p>
                {t("reports.target")}{" "}
                {row.target_user_id ? (
                  <Link
                    href={`/admin/membres/${row.target_user_id}`}
                    className="font-semibold underline underline-offset-4"
                  >
                    {row.target_pseudo ?? t("noPseudo")}
                  </Link>
                ) : null}{" "}
                · {row.target_role ? t(`roles.${row.target_role}`) : null} ·{" "}
                {t(`states.${row.target_state}`)} ·{" "}
                {t("reports.counts", {
                  open: row.target_open_reports,
                  upheld: row.target_upheld_reports,
                })}
              </p>
              <p className="text-grey text-sm">
                {t("reports.reporter", { pseudo: row.reporter_pseudo ?? t("noPseudo") })}
              </p>
              {row.comment ? (
                <blockquote className="border-accent border-l-2 pl-3 text-sm">
                  {row.comment}
                </blockquote>
              ) : null}
              {row.content ? (
                <div className="bg-ink-2 rounded-md p-3 text-sm whitespace-pre-wrap">
                  <span className="text-grey block text-xs">{t("reports.content")}</span>
                  {row.content}
                </div>
              ) : null}
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- reported photo, public bucket
                <img
                  src={url}
                  alt={t("reports.photoAlt")}
                  className="max-h-72 rounded-md object-contain"
                />
              ) : null}
              <form action={decideReportAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="report" value={row.report_id} />
                <fieldset className="space-y-1 sm:col-span-2">
                  <legend className="text-sm font-semibold">{t("reports.outcome")}</legend>
                  <label className="mr-4 inline-flex min-h-11 items-center gap-2">
                    <input type="radio" name="outcome" value="rejected" required />
                    {t("reports.rejected")}
                  </label>
                  {canSanction ? (
                    <label className="inline-flex min-h-11 items-center gap-2">
                      <input type="radio" name="outcome" value="upheld" />
                      {t("reports.upheld")}
                    </label>
                  ) : (
                    <p className="text-grey text-sm">{t("reports.noSanctionPermission")}</p>
                  )}
                </fieldset>
                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor={`${id}-reporter`} className="text-sm font-semibold">
                    {t("reports.reasonReporter")}
                  </label>
                  <textarea
                    id={`${id}-reporter`}
                    name="reasonReporter"
                    required
                    minLength={MOTIVE_MIN}
                    maxLength={MOTIVE_MAX}
                    className={`${field} min-h-20`}
                  />
                </div>
                {canSanction ? (
                  <>
                    <div className="space-y-1">
                      <label htmlFor={`${id}-action`} className="text-sm font-semibold">
                        {t("reports.action")}
                      </label>
                      <select id={`${id}-action`} name="action" className={`${field} min-h-11`}>
                        {REPORT_SANCTIONS.map((action) => (
                          <option key={action} value={action}>
                            {t(`actions.${action}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`${id}-days`} className="text-sm font-semibold">
                        {t("days")}
                      </label>
                      <input
                        id={`${id}-days`}
                        name="days"
                        type="number"
                        min={1}
                        max={SUSPENSION_DAYS_MAX}
                        defaultValue={7}
                        className={`${field} min-h-11`}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label htmlFor={`${id}-target`} className="text-sm font-semibold">
                        {t("reports.reasonTarget")}
                      </label>
                      <textarea
                        id={`${id}-target`}
                        name="reasonTarget"
                        maxLength={MOTIVE_MAX}
                        aria-describedby={`${id}-target-hint`}
                        className={`${field} min-h-20`}
                      />
                      <p id={`${id}-target-hint`} className="text-grey text-xs">
                        {t("reports.reasonTargetHint")}
                      </p>
                    </div>
                  </>
                ) : null}
                <Button type="submit" className="sm:col-span-2">
                  {t("decide")}
                </Button>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
