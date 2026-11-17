import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PilotageOutcome } from "@/components/admin/pilotage-outcome";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { requireAdminPermission } from "@/lib/admin/guard";
import { gaugeSchema } from "@/lib/pilotage";
import { saveZoneAction, setLaunchModeAction, setZoneStatusAction } from "../pilotage-actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.zones" });
  return { title: t("title") };
}

const field = "border-line bg-ink-2 min-h-11 w-full rounded-lg border px-3 py-2";

type ZoneValues = {
  zone?: number;
  slug: string;
  name: string;
  place: string;
  radius: number;
  timezone: string;
  thresholdBads: number;
  womenPct: number;
  menPct: number;
  autoOpen: boolean;
};

async function ZoneForm({ values, id }: { values: ZoneValues; id: string }) {
  const t = await getTranslations("Admin.zones");
  const input = (
    name: keyof ZoneValues,
    label: string,
    props: Record<string, string | number> = {},
  ) => (
    <div className="space-y-1">
      <label htmlFor={`${id}-${name}`} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={`${id}-${name}`}
        name={name}
        defaultValue={String(values[name] ?? "")}
        required
        className={field}
        {...props}
      />
    </div>
  );
  return (
    <form action={saveZoneAction} className="grid gap-3 sm:grid-cols-3">
      {values.zone ? <input type="hidden" name="zone" value={values.zone} /> : null}
      {input("name", t("name"), { maxLength: 60 })}
      {input("slug", t("slug"), { pattern: "[a-z0-9-]{2,40}" })}
      {input("place", t("place"), { maxLength: 80 })}
      {input("radius", t("radius"), { type: "number", min: 5, max: 200 })}
      {input("timezone", t("timezone"), { maxLength: 60 })}
      {input("thresholdBads", t("thresholdBads"), { type: "number", min: 1 })}
      {input("womenPct", t("womenPct"), { type: "number", min: 0, max: 100 })}
      {input("menPct", t("menPct"), { type: "number", min: 0, max: 100 })}
      <label className="flex min-h-11 items-center gap-2 self-end">
        <input type="checkbox" name="autoOpen" defaultChecked={values.autoOpen} />
        {t("autoOpen")}
      </label>
      <Button type="submit" className="sm:col-span-3">
        {values.zone ? t("save") : t("create")}
      </Button>
    </form>
  );
}

/**
 * Les quartiers (SPEC §3): thresholds, the gauge, opening by hand (the members are told), and the
 * global mode (super admin only). An open quartier never closes by itself.
 */
export default async function ZonesPage({ searchParams }: Props) {
  const member = await requireAdminPermission("zones.edit");
  const t = await getTranslations("Admin.zones");
  const { error, done } = await searchParams;
  const [{ data }, { data: launchMode }] = await Promise.all([
    member.supabase.rpc("admin_zones"),
    member.supabase.rpc("admin_launch_mode"),
  ]);
  const zones = data ?? [];
  const mode = launchMode === "open" ? "open" : "zones";

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("lead")}</p>
        <PilotageOutcome error={error} done={done} />
      </div>

      <section
        aria-labelledby="mode-title"
        className="border-line space-y-2 rounded-lg border bg-[#121214] p-4"
      >
        <h2 id="mode-title" className="font-display text-2xl uppercase">
          {t("modeTitle")}
        </h2>
        <p>{t(`mode_${mode}`)}</p>
        <form action={setLaunchModeAction}>
          <input type="hidden" name="mode" value={mode === "open" ? "zones" : "open"} />
          <Button type="submit" variant="secondary">
            {mode === "open" ? t("switchToZones") : t("switchToOpen")}
          </Button>
        </form>
        <p className="text-grey text-sm">{t("modeHint")}</p>
      </section>

      <ul className="space-y-6">
        {zones.map((zone) => {
          const gauge = gaugeSchema.safeParse(zone.gauge);
          return (
            <li
              key={zone.zone_id}
              className="border-line space-y-4 rounded-lg border bg-[#121214] p-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-display text-2xl uppercase">{zone.name}</h2>
                <span
                  className={
                    zone.status === "open"
                      ? "text-green-bright font-semibold"
                      : "text-accent font-semibold"
                  }
                >
                  {t(`status_${zone.status}`)}
                </span>
                <Link
                  href={`/admin/quartiers/${zone.zone_id}`}
                  className="underline underline-offset-4"
                >
                  {t("health")}
                </Link>
              </div>
              {gauge.success ? (
                <p className="text-sm">
                  {t("gauge", {
                    bads: gauge.data.bads,
                    threshold: gauge.data.threshold_bads,
                    girls: gauge.data.bad_girls,
                    minGirls: gauge.data.min_bad_girls,
                    boys: gauge.data.bad_boys,
                    minBoys: gauge.data.min_bad_boys,
                    visitors: gauge.data.visitors_waiting,
                  })}{" "}
                  <strong>{gauge.data.ready ? t("ready") : t("notReady")}</strong>
                </p>
              ) : null}
              <form action={setZoneStatusAction}>
                <input type="hidden" name="zone" value={zone.zone_id} />
                <input
                  type="hidden"
                  name="status"
                  value={zone.status === "open" ? "waitlist" : "open"}
                />
                <Button type="submit" variant={zone.status === "open" ? "secondary" : "primary"}>
                  {zone.status === "open" ? t("toWaitlist") : t("open")}
                </Button>
              </form>
              <details>
                <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                  {t("edit")}
                </summary>
                <ZoneForm
                  id={`zone-${zone.zone_id}`}
                  values={{
                    zone: zone.zone_id,
                    slug: zone.slug,
                    name: zone.name,
                    place: zone.center_name,
                    radius: zone.radius_km,
                    timezone: zone.timezone,
                    thresholdBads: zone.threshold_bads,
                    womenPct: zone.threshold_women_pct,
                    menPct: zone.threshold_men_pct,
                    autoOpen: zone.auto_open,
                  }}
                />
              </details>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="new-zone" className="space-y-3">
        <h2 id="new-zone" className="font-display text-2xl uppercase">
          {t("new")}
        </h2>
        <ZoneForm
          id="zone-new"
          values={{
            slug: "",
            name: "",
            place: "",
            radius: 25,
            timezone: "Europe/Paris",
            thresholdBads: 50,
            womenPct: 40,
            menPct: 20,
            autoOpen: false,
          }}
        />
      </section>
    </div>
  );
}
