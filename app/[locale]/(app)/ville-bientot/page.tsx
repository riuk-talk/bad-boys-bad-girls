import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CopyLink } from "@/components/city/copy-link";
import { ButtonLink } from "@/components/ui/button-link";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requireMember } from "@/lib/auth/user";
import { SITE_URL } from "@/lib/env";
import { localizedPath } from "@/lib/i18n-path";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "City" });
  return { title: t("title") };
}

function Gauge({ label, value, max }: { label: string; value: number; max: number }) {
  const percent = Math.min(100, Math.round((value / Math.max(max, 1)) * 100));
  return (
    <div className="space-y-2">
      <p className="font-semibold">{label}</p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(value, max)}
        className="bg-ink-3 h-3 overflow-hidden rounded-full"
      >
        <div className="bg-gold h-full rounded-full" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

// "Ta ville ouvre bientôt" (SPEC §3): progress of the member's zone + referral link.
export default async function CityPage() {
  const member = await requireMember();
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("City");
  const [{ data: profile }, { data: progress }, { data: recruited }] = await Promise.all([
    member.supabase
      .from("profiles")
      .select("referral_code, onboarding_completed_at")
      .eq("id", member.userId)
      .maybeSingle(),
    member.supabase.rpc("zone_progress"),
    member.supabase.rpc("referral_count"),
  ]);
  if (!profile?.onboarding_completed_at) return redirect({ href: "/onboarding", locale });

  const zone = progress?.[0];
  const isOpen = zone && (zone.status === "open" || zone.launch_mode === "open");
  const referralUrl = `${SITE_URL}${localizedPath("/inscription", locale)}?parrain=${profile.referral_code}`;

  return (
    <div className="mx-auto max-w-2xl space-y-10 px-4 py-8 sm:px-6 sm:py-12">
      <header className="space-y-3">
        <h1 className="font-display text-4xl tracking-wide uppercase sm:text-5xl">
          {isOpen ? t("open") : t("title")}
        </h1>
        {!isOpen ? <p className="text-cream/90 text-lg">{t("lead")}</p> : null}
      </header>

      {isOpen ? (
        <ButtonLink href="/ma-fiche">{t("openLink")}</ButtonLink>
      ) : zone ? (
        <section className="bg-ink-2 space-y-6 rounded-[var(--radius-card)] p-6">
          <p className="font-display text-2xl tracking-wide uppercase">
            {t("zone", { name: zone.zone_name })}
          </p>
          <Gauge
            label={t("profilesGauge", {
              count: zone.complete_profiles,
              threshold: zone.threshold_profiles,
            })}
            value={zone.complete_profiles}
            max={zone.threshold_profiles}
          />
          <Gauge
            label={t("womenGauge", { pct: zone.women_pct, threshold: zone.threshold_women_pct })}
            value={zone.women_pct}
            max={zone.threshold_women_pct}
          />
        </section>
      ) : (
        <p className="border-line bg-ink-2 rounded-lg border px-4 py-3">{t("noZone")}</p>
      )}

      <section aria-labelledby="referral-title" className="space-y-4">
        <h2 id="referral-title" className="font-display text-3xl tracking-wide uppercase">
          {t("referralTitle")}
        </h2>
        <p>{t("referralLead")}</p>
        <CopyLink url={referralUrl} />
        <p className="text-gold font-semibold">{t("recruited", { count: recruited ?? 0 })}</p>
        <p className="text-grey text-sm">{t("noReward")}</p>
      </section>
    </div>
  );
}
