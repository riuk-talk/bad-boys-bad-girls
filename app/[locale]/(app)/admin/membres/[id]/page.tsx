import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import * as z from "zod/mini";
import { Outcome } from "@/components/admin/outcome";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/user";
import {
  MEMBER_SANCTIONS,
  MOTIVE_MAX,
  MOTIVE_MIN,
  SUSPENSION_DAYS_MAX,
  memberRecordSchema,
} from "@/lib/moderation";
import { sanctionAction } from "../../moderation-actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.member" });
  return { title: t("title") };
}

const field = "border-line bg-ink-2 w-full rounded-lg border px-3 py-2";

/**
 * Fiche d'un membre côté Greffe (SPEC §15): state, reports received, flagged texts, every decision
 * about them, and the sanction form (motive mandatory, sent to the member).
 */
export default async function MemberRecordPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const member = await requireMember();
  const { data: isAdmin } = await member.supabase.rpc("is_admin");
  if (isAdmin !== true) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const { error, done } = await searchParams;
  const { data } = await member.supabase.rpc("admin_member", { p_user: id });
  const parsed = memberRecordSchema.safeParse(data);
  if (!parsed.success) notFound();
  const record = parsed.data;
  const when = (value: string) =>
    format.dateTime(new Date(value), { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">
          {record.pseudo ?? t("noPseudo")}
        </h1>
        <p className="text-cream/85">
          {record.role ? t(`roles.${record.role}`) : null} · {t(`states.${record.state}`)}
          {record.suspended_until
            ? ` · ${t("member.until", { date: when(record.suspended_until) })}`
            : null}
          {record.good_conduct ? ` · ${t("member.goodConduct")}` : null}
          {record.is_admin ? ` · ${t("member.admin")}` : null}
        </p>
        <p className="text-grey text-sm">
          {t("member.facts", {
            created: when(record.created_at),
            zone: record.zone ?? "—",
            made: record.reports_made,
          })}
        </p>
        <Outcome error={error} done={done} />
      </div>

      <section
        aria-labelledby="sanction-title"
        className="border-line space-y-3 rounded-lg border bg-[#121214] p-4"
      >
        <h2 id="sanction-title" className="font-display text-2xl uppercase">
          {t("member.sanction")}
        </h2>
        <form action={sanctionAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="member" value={record.id} />
          <div className="space-y-1">
            <label htmlFor="sanction-action" className="text-sm font-semibold">
              {t("member.action")}
            </label>
            <select id="sanction-action" name="action" required className={`${field} min-h-11`}>
              {MEMBER_SANCTIONS.map((action) => (
                <option key={action} value={action}>
                  {t(`actions.${action}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="sanction-days" className="text-sm font-semibold">
              {t("days")}
            </label>
            <input
              id="sanction-days"
              name="days"
              type="number"
              min={1}
              max={SUSPENSION_DAYS_MAX}
              defaultValue={7}
              className={`${field} min-h-11`}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="sanction-reason" className="text-sm font-semibold">
              {t("member.reason")}
            </label>
            <textarea
              id="sanction-reason"
              name="reason"
              required
              minLength={MOTIVE_MIN}
              maxLength={MOTIVE_MAX}
              aria-describedby="sanction-reason-hint"
              className={`${field} min-h-24`}
            />
            <p id="sanction-reason-hint" className="text-grey text-xs">
              {t("member.reasonHint")}
            </p>
          </div>
          <Button type="submit" variant="danger" className="sm:col-span-2">
            {t("member.apply")}
          </Button>
        </form>
      </section>

      <section aria-labelledby="actions-title" className="space-y-3">
        <h2 id="actions-title" className="font-display text-2xl uppercase">
          {t("member.history")}
        </h2>
        {record.actions.length === 0 ? <p className="text-grey">{t("member.noActions")}</p> : null}
        <ul className="divide-line divide-y">
          {record.actions.map((action) => (
            <li key={action.id} className="space-y-1 py-3">
              <p>
                <span className="font-semibold">{t(`actions.${action.action}`)}</span>{" "}
                <span className="text-grey text-sm">{when(action.created_at)}</span>
                {action.ends_at ? (
                  <span className="text-grey text-sm">
                    {" "}
                    · {t("member.until", { date: when(action.ends_at) })}
                  </span>
                ) : null}
              </p>
              {action.reason ? (
                <p className="text-sm whitespace-pre-wrap">{action.reason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="received-title" className="space-y-3">
        <h2 id="received-title" className="font-display text-2xl uppercase">
          {t("member.received")}
        </h2>
        {record.reports_received.length === 0 ? (
          <p className="text-grey">{t("member.noReports")}</p>
        ) : null}
        <ul className="divide-line divide-y">
          {record.reports_received.map((report) => (
            <li key={report.id} className="space-y-1 py-3">
              <p>
                <span className="font-semibold">{t(`categories.${report.category}`)}</span> ·{" "}
                {t(`targets.${report.target_type}`)} · {t(`statuses.${report.status}`)}{" "}
                <span className="text-grey text-sm">{when(report.created_at)}</span>
              </p>
              {report.comment ? <p className="text-sm">{report.comment}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="flags-title" className="space-y-3">
        <h2 id="flags-title" className="font-display text-2xl uppercase">
          {t("member.flags")}
        </h2>
        {record.flags.length === 0 ? <p className="text-grey">{t("member.noFlags")}</p> : null}
        <ul className="divide-line divide-y">
          {record.flags.map((flag) => (
            <li key={flag.id} className="space-y-1 py-3">
              <p>
                <span className="font-semibold">{t(`sources.${flag.source}`)}</span> ·{" "}
                {t(`statuses.${flag.status}`)}{" "}
                <span className="text-grey text-sm">{when(flag.created_at)}</span>
              </p>
              <p className="text-sm whitespace-pre-wrap">{flag.excerpt}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
