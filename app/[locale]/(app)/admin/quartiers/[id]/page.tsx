import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import * as z from "zod/mini";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { requireAdminPermission } from "@/lib/admin/guard";
import { healthPeriod, healthSchema, rate } from "@/lib/pilotage";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.health" });
  return { title: t("title") };
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="border-line rounded-lg border bg-[#121214] p-3">
      <dt className="text-grey text-sm">{label}</dt>
      <dd className="font-display text-3xl tabular-nums">{value}</dd>
      {detail ? <dd className="text-grey text-xs">{detail}</dd> : null}
    </div>
  );
}

/**
 * Tableau de santé d'un quartier (SPEC §15), from our own tables only, seed accounts left out.
 * The acceptance rate by right and wrong bet must stay neutral: a gap would leak the bet.
 */
export default async function HealthPage({ params, searchParams }: Props) {
  const { id } = await params;
  const zoneId = z.coerce.number().check(z.int(), z.positive(), z.maximum(32767)).safeParse(id);
  if (!zoneId.success) notFound();
  const member = await requireAdminPermission("zones.edit");
  const t = await getTranslations("Admin.health");
  const period = healthPeriod((await searchParams).from, (await searchParams).to, new Date());
  const [{ data }, { data: zones }] = await Promise.all([
    member.supabase.rpc("admin_zone_health", {
      p_zone: zoneId.data,
      p_from: period.from,
      p_to: period.to,
    }),
    member.supabase.from("launch_zones").select("name").eq("id", zoneId.data).maybeSingle(),
  ]);
  const parsed = healthSchema.safeParse(data);
  if (!parsed.success || !zones) notFound();
  const h = parsed.data;
  const pct = (part: number, whole: number) => {
    const value = rate(part, whole);
    return value === null ? "—" : `${value} %`;
  };
  const num = (value: number | null) => (value === null ? "—" : String(value));
  const roles = ["bad", "visitor"] as const;
  const genders = ["woman", "man", "non_binary", "other"] as const;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <Link href="/admin/quartiers" className="text-sm underline underline-offset-4">
          {t("back")}
        </Link>
        <h1 className="font-display text-4xl tracking-wide uppercase">
          {t("heading", { zone: zones.name })}
        </h1>
        <p className="text-cream/85">{t("lead")}</p>
      </div>
      <form className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="health-from" className="text-sm font-semibold">
            {t("from")}
          </label>
          <input
            id="health-from"
            type="date"
            name="from"
            defaultValue={period.from}
            className="border-line bg-ink-2 min-h-11 rounded-lg border px-3"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="health-to" className="text-sm font-semibold">
            {t("to")}
          </label>
          <input
            id="health-to"
            type="date"
            name="to"
            defaultValue={period.to}
            className="border-line bg-ink-2 min-h-11 rounded-lg border px-3"
          />
        </div>
        <Button type="submit" variant="secondary">
          {t("apply")}
        </Button>
      </form>

      <section aria-labelledby="h-members" className="space-y-3">
        <h2 id="h-members" className="font-display text-2xl uppercase">
          {t("members")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label={t("signedUp")} value={String(h.members.signed_up)} />
          <Tile label={t("dossiers")} value={String(h.members.complete.dossiers)} />
          <Tile label={t("permits")} value={String(h.members.complete.permits)} />
          <Tile
            label={t("gaugeBads")}
            value={`${h.gauge.bads}/${h.gauge.threshold_bads}`}
            detail={t("gaugeDetail", {
              girls: h.gauge.bad_girls,
              minGirls: h.gauge.min_bad_girls,
              boys: h.gauge.bad_boys,
              minBoys: h.gauge.min_bad_boys,
              visitors: h.gauge.visitors_waiting,
            })}
          />
        </dl>
        <table className="w-full text-left text-sm">
          <caption className="text-grey text-left">{t("byGender")}</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1">
                {" "}
              </th>
              {genders.map((gender) => (
                <th key={gender} scope="col" className="py-1">
                  {t(`genders.${gender}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role} className="border-line border-t">
                <th scope="row" className="py-1">
                  {t(`roles.${role}`)}
                </th>
                {genders.map((gender) => (
                  <td key={gender} className="py-1 tabular-nums">
                    {h.members.by_role_gender[`${role}:${gender}`] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="h-requests" className="space-y-3">
        <h2 id="h-requests" className="font-display text-2xl uppercase">
          {t("requests")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile
            label={t("perDay")}
            value={String(h.requests.per_day)}
            detail={t("sent", { count: h.requests.sent })}
          />
          <Tile label={t("acceptance")} value={pct(h.requests.accepted, h.requests.decided)} />
          <Tile
            label={t("acceptanceRight")}
            value={pct(h.requests.accepted_right_bet, h.requests.decided_right_bet)}
            detail={t("acceptanceWrong", {
              rate: pct(h.requests.accepted_wrong_bet, h.requests.decided_wrong_bet),
            })}
          />
          <Tile label={t("responseHours")} value={num(h.requests.avg_response_hours)} />
          <Tile label={t("autoClosed")} value={pct(h.requests.auto_closed, h.requests.sent)} />
          <Tile label={t("slotChosen")} value={pct(h.requests.with_visit, h.requests.accepted)} />
          <Tile
            label={t("slotsDeclined")}
            value={pct(h.requests.slots_declined, h.requests.accepted)}
          />
        </dl>
      </section>

      <section aria-labelledby="h-visits" className="space-y-3">
        <h2 id="h-visits" className="font-display text-2xl uppercase">
          {t("visits")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label={t("badPresence")} value={pct(h.visits.bad_present, h.visits.started)} />
          <Tile
            label={t("visitorPresence")}
            value={pct(h.visits.visitor_present, h.visits.started)}
          />
          <Tile label={t("lateCancellations")} value={String(h.visits.late_cancellations)} />
          <Tile label={t("released")} value={pct(h.visits.released, h.visits.both_present)} />
          <Tile
            label={t("cavales")}
            value={`${h.cavales.accepted}/${h.cavales.proposed}`}
            detail={t("cavalesDetail")}
          />
          <Tile
            label={t("underFive")}
            value={pct(h.promenade.under_five, h.promenade.visitor_days)}
          />
        </dl>
      </section>

      <section aria-labelledby="h-retention" className="space-y-3">
        <h2 id="h-retention" className="font-display text-2xl uppercase">
          {t("retention")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {roles.map((role) => {
            const r = h.retention?.[role];
            return [
              <Tile
                key={`${role}-7`}
                label={t("d7", { role: t(`roles.${role}`) })}
                value={r ? pct(r.back_d7, r.cohort_d7) : "—"}
              />,
              <Tile
                key={`${role}-30`}
                label={t("d30", { role: t(`roles.${role}`) })}
                value={r ? pct(r.back_d30, r.cohort_d30) : "—"}
              />,
            ];
          })}
        </dl>
        <p className="text-grey text-sm">{t("retentionHint")}</p>
      </section>

      <section aria-labelledby="h-ops" className="space-y-3">
        <h2 id="h-ops" className="font-display text-2xl uppercase">
          {t("operations")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile
            label={t("reports")}
            value={String(h.moderation.reports)}
            detail={t("hours", { hours: num(h.moderation.avg_report_hours) })}
          />
          <Tile
            label={t("greffe")}
            value={num(h.moderation.avg_greffe_hours)}
            detail={t("photos", { count: h.moderation.photos_reviewed })}
          />
          <Tile label={t("pushRate")} value={pct(h.push.subscribed, h.push.members)} />
          <Tile label={t("pushFailures")} value={pct(h.push.failed, h.push.sent + h.push.failed)} />
        </dl>
      </section>
    </div>
  );
}
