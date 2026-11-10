import { Sun } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { BadCard, type BadCardData } from "@/components/relations/bad-card";
import { CriteriaBar } from "@/components/relations/criteria-bar";
import { PermitPending } from "@/components/relations/permit-pending";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { parseEmptyReason } from "@/lib/relations/empty-reason";
import { publicPhotoUrl, requireRole } from "@/lib/relations/server";
import { nextPromenadeAt, untilParts } from "@/lib/relations/time";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Relations.promenade" });
  return { title: t("title") };
}

/** La Promenade (SPEC §12, maquette Promenade.dc.html): 5 Bads from 21:00, Visitors only. */
export default async function PromenadePage() {
  const { supabase, userId, profile } = await requireRole("visitor");
  const t = await getTranslations("Relations.promenade");
  const criteria = await getTranslations("Criteria");
  const [{ data: picks }, { data: face }] = await Promise.all([
    supabase.rpc("get_my_promenade"),
    supabase.from("photos").select("status").eq("owner_id", userId).eq("position", 0).maybeSingle(),
    supabase.rpc("mark_notifications_read", { p_types: ["promenade_open"] }),
  ]);
  const bads: BadCardData[] = (picks ?? []).map((pick) => ({
    id: pick.id,
    pseudo: pick.pseudo,
    gender: pick.gender,
    age: pick.age,
    city: pick.city,
    distanceKm: pick.distance_km,
    photoUrl: publicPhotoUrl(supabase, pick.photo_small),
    complicity: pick.complicity,
    goodConduct: pick.good_conduct,
    requestsOpen: pick.requests_open,
  }));
  const now = new Date();
  const next = untilParts(now, nextPromenadeAt(now));
  const [first, ...others] = bads;
  // An empty Promenade says why when it is the criteria or the quartier (10d).
  const reason =
    bads.length === 0 ? parseEmptyReason((await supabase.rpc("search_empty_reason")).data) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex flex-col items-center gap-1.5 text-center">
        <p className="font-stamp text-accent text-xs tracking-[0.25em]">{t("eyebrow")}</p>
        <p
          aria-hidden="true"
          className="font-display text-accent text-5xl leading-none [text-shadow:0_0_18px_rgb(212_164_55/0.45)]"
        >
          21:00
        </p>
        <h1 className="text-cream/90 text-base font-semibold">
          {bads.length > 0 ? t("lead", { count: bads.length }) : t("titleEmpty")}
        </h1>
      </header>

      <CriteriaBar
        genders={profile.seeking_genders}
        ageMin={profile.seek_age_min}
        ageMax={profile.seek_age_max}
      />

      {face?.status !== "approved" ? <PermitPending /> : null}

      {first ? (
        <>
          <BadCard bad={first} size="large" priority />
          {others.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {others.map((bad) => (
                <li key={bad.id} className="contents">
                  <BadCard bad={bad} />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={<Sun className="size-8" />}
          title={t("emptyTitle")}
          body={reason ? criteria(`reasons.${reason}`) : t("emptyBody")}
          action={<ButtonLink href="/decouverte">{t("toDiscover")}</ButtonLink>}
        />
      )}

      <p className="text-grey text-center text-[13px]">
        {t.rich("next", {
          hours: next.hours,
          minutes: next.minutes,
          strong: (chunks) => <strong className="text-cream">{chunks}</strong>,
        })}
        {bads.length > 0 ? (
          <>
            {" · "}
            <LocalizedLink href="/decouverte" className="text-cream underline underline-offset-4">
              {t("toDiscoverShort")}
            </LocalizedLink>
          </>
        ) : null}
      </p>
    </div>
  );
}
