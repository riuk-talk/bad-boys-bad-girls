import { Eye } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PermitLetterCard } from "@/components/relations/permit-letter-card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { requireAdminPermission } from "@/lib/admin/guard";
import {
  PAGE_SIZE,
  parseVisitorPermits,
  parseVueBadFilters,
  vueBadQuery,
} from "@/lib/admin/vue-bad";
import { publicPhotoUrl } from "@/lib/relations/server";
import { Constants } from "@/lib/supabase/database.types";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "GreffeView" });
  return { title: t("badTitle") };
}

const field = "border-line bg-ink-2 min-h-11 w-full rounded-lg border px-3 py-2";
const AGES = Array.from({ length: 82 }, (_, index) => 18 + index);

/**
 * « Voir comme un Bad » (10f-bis): every Visitor whose Permis is delivered, without the criteria
 * of a Bad nor a quartier, each as the Permis card a Bad reads in its Courrier. Read only: nothing
 * is written about the Visitors; each Permis shown goes into the Greffe's log
 * (admin_view_visitors, vue_bad.view).
 */
export default async function SeeAsBadPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const member = await requireAdminPermission("vue_bad.view");
  const t = await getTranslations("GreffeView");
  const genders = await getTranslations("Onboarding.identity.genders");
  const filters = parseVueBadFilters(await searchParams);
  const [{ data }, { data: zones }] = await Promise.all([
    member.supabase.rpc("admin_view_visitors", {
      p_gender: filters.gender ?? undefined,
      p_age_min: filters.ageMin ?? undefined,
      p_age_max: filters.ageMax ?? undefined,
      p_zone: filters.zone ?? undefined,
      p_page: filters.page,
    }),
    member.supabase.rpc("admin_zone_names"),
  ]);
  const permits = parseVisitorPermits(data);
  const total = permits[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col">
      <div
        role="note"
        aria-label={t("banner")}
        className="bg-cream text-ink sticky top-0 z-40 border-b-2 border-[#0e0e10] px-4 py-2 sm:px-6"
      >
        <p className="mx-auto flex max-w-5xl items-center gap-2 text-sm font-bold">
          <Eye aria-hidden="true" className="size-4 shrink-0" />
          {t("banner")}
        </p>
        <p className="mx-auto max-w-5xl text-xs">{t("badBannerHint")}</p>
      </div>
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        <div className="space-y-1">
          <h1 className="font-display text-3xl tracking-wide uppercase">{t("badTitle")}</h1>
          <p className="text-cream/85 text-sm">{t("badLead")}</p>
        </div>

        <form aria-label={t("badFilters")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-sm">
            <span className="font-semibold">{t("badGender")}</span>
            <select name="genre" defaultValue={filters.gender ?? ""} className={field}>
              <option value="">{t("badAny")}</option>
              {Constants.public.Enums.gender.map((value) => (
                <option key={value} value={value}>
                  {genders(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">{t("badAgeMin")}</span>
            <select name="ageMin" defaultValue={filters.ageMin ?? ""} className={field}>
              <option value="">{t("badAny")}</option>
              {AGES.map((age) => (
                <option key={age} value={age}>
                  {age}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">{t("badAgeMax")}</span>
            <select name="ageMax" defaultValue={filters.ageMax ?? ""} className={field}>
              <option value="">{t("badAny")}</option>
              {AGES.map((age) => (
                <option key={age} value={age}>
                  {age}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">{t("badZone")}</span>
            <select name="quartier" defaultValue={filters.zone ?? ""} className={field}>
              <option value="">{t("badAny")}</option>
              {(zones ?? []).map((zone) => (
                <option key={zone.zone_id} value={zone.zone_id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" className="self-end">
            {t("badApply")}
          </Button>
        </form>

        <p role="status" className="text-grey text-sm">
          {t("badCount", { count: total })}
        </p>
        {permits.length === 0 ? <p className="text-grey">{t("badEmpty")}</p> : null}
        <ul className="grid gap-4 lg:grid-cols-2">
          {permits.map((permit) => (
            <li key={permit.id} className="space-y-1">
              <PermitLetterCard
                permit={permit}
                photo={publicPhotoUrl(member.supabase, permit.photo?.small ?? permit.photo?.large)}
                place={permit.city}
                locale={locale}
                headingLevel={2}
                headingId={`permit-${permit.id}`}
              />
              <p className="text-grey text-xs">
                {permit.zone_name ? t("badZoneOf", { zone: permit.zone_name }) : t("badNoZone")}
              </p>
            </li>
          ))}
        </ul>

        {pages > 1 ? (
          <nav aria-label={t("badPages")} className="flex items-center justify-between gap-3">
            {filters.page > 1 ? (
              <Link
                href={`/admin/vue-bad${vueBadQuery(filters, filters.page - 1)}`}
                className="inline-flex min-h-11 items-center underline underline-offset-4"
              >
                {t("badPrevious")}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-grey text-sm">{t("badPage", { page: filters.page, pages })}</span>
            {filters.page < pages ? (
              <Link
                href={`/admin/vue-bad${vueBadQuery(filters, filters.page + 1)}`}
                className="inline-flex min-h-11 items-center underline underline-offset-4"
              >
                {t("badNext")}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
