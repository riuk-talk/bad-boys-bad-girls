import { Compass, SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { BadCardData } from "@/components/relations/bad-card";
import { CriteriaBar } from "@/components/relations/criteria-bar";
import { DossierCard } from "@/components/relations/dossier-card";
import { PermitPending } from "@/components/relations/permit-pending";
import { ButtonLink } from "@/components/ui/button-link";
import { buttonClasses } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import type { Locale } from "@/i18n/routing";
import { localizedPath } from "@/lib/i18n-path";
import { parseEmptyReason } from "@/lib/relations/empty-reason";
import { DISTANCES, filtersQuery, PAGE_SIZE, parseDiscoverFilters } from "@/lib/relations/discover";
import { publicPhotoUrl, requireRole } from "@/lib/relations/server";
import { localize, type Label } from "@/lib/relations/types";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Relations.discover" });
  return { title: t("title") };
}

const AGES = Array.from({ length: 82 }, (_, index) => String(18 + index));

/**
 * La Découverte (SPEC §12 bis): every visible Bad, Visitors only, sorted by complicity; each one
 * a kraft folder (DecouverteDossiers.dc.html, 2026-10-24) that opens the Fiche over the list.
 */
export default async function DiscoverPage({ searchParams }: Props) {
  const { supabase, userId, locale, profile } = await requireRole("visitor");
  const t = await getTranslations("Relations.discover");
  const criteria = await getTranslations("Criteria");
  const filters = parseDiscoverFilters(await searchParams);
  const [{ data: rows }, { data: tribes }, { data: face }] = await Promise.all([
    supabase.rpc("discover_bads", {
      p_age_min: filters.ageMin,
      p_age_max: filters.ageMax,
      p_max_km: filters.km ?? undefined,
      p_tribe_ids: filters.tribes.length ? filters.tribes : undefined,
      p_good_conduct_only: filters.goodConductOnly,
      p_recently_active: filters.recentlyActive,
      p_cursor_key: filters.cursor?.key,
      p_cursor_id: filters.cursor?.id,
      p_limit: PAGE_SIZE,
    }),
    supabase.from("tribes").select("id, label").eq("is_active", true).order("sort"),
    // The validated face photo, if any (a new one may wait beside it, 10-50 corrected).
    supabase
      .from("photos")
      .select("status")
      .eq("owner_id", userId)
      .eq("position", 0)
      .eq("status", "approved")
      .maybeSingle(),
  ]);
  const bads: BadCardData[] = (rows ?? []).map((row) => ({
    id: row.id,
    pseudo: row.pseudo,
    gender: row.gender,
    age: row.age,
    city: row.city,
    distanceKm: row.distance_km,
    photoUrl: publicPhotoUrl(supabase, row.photo_small),
    complicity: row.complicity,
    goodConduct: row.good_conduct,
    requestsOpen: row.requests_open,
  }));
  const last = rows?.at(-1);
  const hasMore = (rows?.length ?? 0) === PAGE_SIZE && last;
  const action = localizedPath("/decouverte", locale as Locale);
  const activeFilters =
    filters.tribes.length +
    (filters.km ? 1 : 0) +
    (filters.goodConductOnly ? 1 : 0) +
    (filters.recentlyActive ? 1 : 0) +
    (filters.ageMin !== 18 || filters.ageMax !== 99 ? 1 : 0);
  // An empty list without filters says why (10d): quartier closed, or criteria that fit no Bad.
  const reason =
    bads.length === 0 && !filters.cursor && activeFilters === 0
      ? parseEmptyReason((await supabase.rpc("search_empty_reason")).data)
      : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="space-y-1 text-center">
        <p className="font-stamp text-accent text-xs tracking-[0.25em]">{t("eyebrow")}</p>
        <h1 className="font-display text-4xl uppercase">{t("title")}</h1>
        <p className="text-grey text-sm">{t("lead")}</p>
      </header>

      <CriteriaBar
        genders={profile.seeking_genders}
        ageMin={profile.seek_age_min}
        ageMax={profile.seek_age_max}
      />

      {face?.status !== "approved" ? <PermitPending /> : null}

      <details
        className="border-line bg-ink-2 group rounded-md border"
        open={activeFilters > 0 ? true : undefined}
      >
        <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 font-semibold">
          <SlidersHorizontal aria-hidden="true" className="text-accent size-4" />
          {t("filters")}
          {activeFilters > 0 ? (
            <span className="text-grey text-sm font-normal">({activeFilters})</span>
          ) : null}
        </summary>
        <form
          method="get"
          action={action}
          className="grid gap-4 border-t border-[var(--color-line)] p-4 sm:grid-cols-3"
        >
          <Select
            id="ageMin"
            name="ageMin"
            label={t("ageMin")}
            defaultValue={String(filters.ageMin)}
            options={AGES.map((age) => ({ value: age, label: age }))}
          />
          <Select
            id="ageMax"
            name="ageMax"
            label={t("ageMax")}
            defaultValue={String(filters.ageMax)}
            options={AGES.map((age) => ({ value: age, label: age }))}
          />
          <Select
            id="km"
            name="km"
            label={t("distance")}
            defaultValue={filters.km ? String(filters.km) : ""}
            options={[
              { value: "", label: t("anyDistance") },
              ...DISTANCES.map((km) => ({ value: String(km), label: t("withinKm", { km }) })),
            ]}
          />
          <fieldset className="sm:col-span-3">
            <legend className="mb-2 text-sm font-semibold">{t("signs")}</legend>
            <div className="flex flex-wrap gap-2">
              {(tribes ?? []).map((tribe) => (
                <label
                  key={tribe.id}
                  className="border-line has-[:checked]:border-accent has-[:checked]:text-accent has-focus-visible:outline-accent inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3.5 text-sm has-focus-visible:outline-3"
                >
                  <input
                    type="checkbox"
                    name="tribe"
                    value={tribe.id}
                    defaultChecked={filters.tribes.includes(tribe.id)}
                    className="sr-only"
                  />
                  {localize(tribe.label as Label, locale)}
                </label>
              ))}
            </div>
          </fieldset>
          <Checkbox
            id="conduct"
            name="conduct"
            value="1"
            defaultChecked={filters.goodConductOnly}
            label={t("goodConductOnly")}
          />
          <Checkbox
            id="active"
            name="active"
            value="1"
            defaultChecked={filters.recentlyActive}
            label={t("recentlyActive")}
          />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
            <button type="submit" className={buttonClasses("primary", "md")}>
              {t("apply")}
            </button>
            {activeFilters > 0 ? (
              <ButtonLink href="/decouverte" variant="ghost">
                {t("reset")}
              </ButtonLink>
            ) : null}
          </div>
        </form>
      </details>

      {bads.length > 0 ? (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-3.5 sm:grid-cols-3 lg:grid-cols-4">
          {bads.map((bad, index) => (
            <li key={bad.id}>
              <DossierCard bad={bad} priority={index < 2} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Compass className="size-8" />}
          title={filters.cursor ? t("endTitle") : t("emptyTitle")}
          body={
            filters.cursor
              ? t("endBody")
              : activeFilters > 0
                ? t("emptyFiltered")
                : reason
                  ? criteria(`reasons.${reason}`)
                  : t("emptyBody")
          }
        />
      )}

      {hasMore && last ? (
        <ButtonLink
          href={`/decouverte${filtersQuery(filters, { key: last.sort_key, id: last.id })}`}
          variant="secondary"
          className="self-center"
        >
          {t("more")}
        </ButtonLink>
      ) : null}
    </div>
  );
}
