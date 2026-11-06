import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { DossierCard } from "@/components/relations/dossier-card";
import { requireMember } from "@/lib/auth/user";
import { publicPhotoUrl } from "@/lib/relations/server";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ zone?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "GreffeView" });
  return { title: t("promenadeTitle") };
}

/**
 * The Promenade of the day of a quartier, as the Greffe (10a). The Promenade is drawn for each
 * Visitor: here are the Bads drawn today in the quartier, each once, with their best rank and how
 * many Visitors drew them, never who those Visitors are. Read only.
 */
export default async function GreffePromenadePage({ searchParams }: Props) {
  const member = await requireMember();
  const t = await getTranslations("GreffeView");
  const { zone } = await searchParams;
  const { data: zones, error } = await member.supabase.rpc("admin_zones");
  if (error) notFound();
  const all = zones ?? [];
  const chosen = all.find((z) => String(z.zone_id) === zone) ?? all[0] ?? null;
  const { data: rows } = chosen
    ? await member.supabase.rpc("admin_view_promenade", { p_zone: chosen.zone_id })
    : { data: [] };
  const picks = rows ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <div className="space-y-1">
        <h1 className="font-display text-3xl tracking-wide uppercase">{t("promenadeTitle")}</h1>
        <p className="text-cream/85 text-sm">{t("promenadeLead")}</p>
      </div>
      {all.length === 0 ? (
        <p className="text-grey">{t("noZones")}</p>
      ) : (
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t("zoneLabel")}
            <select
              name="zone"
              defaultValue={chosen ? String(chosen.zone_id) : undefined}
              className="border-line bg-ink-2 min-h-11 rounded-lg border px-3"
            >
              {all.map((z) => (
                <option key={z.zone_id} value={String(z.zone_id)}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="border-cream/80 text-cream hover:bg-cream hover:text-ink min-h-11 rounded-full border-2 px-5 font-semibold"
          >
            {t("show")}
          </button>
        </form>
      )}
      {chosen && picks.length === 0 ? <p className="text-grey">{t("promenadeEmpty")}</p> : null}
      {picks.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {picks.map((pick, index) => (
            <li key={pick.id} className="space-y-1">
              <DossierCard
                bad={{
                  id: pick.id,
                  pseudo: pick.pseudo,
                  gender: pick.gender,
                  age: pick.age,
                  city: pick.city,
                  distanceKm: null,
                  photoUrl: publicPhotoUrl(member.supabase, pick.photo_small),
                  complicity: null,
                  goodConduct: pick.good_conduct,
                  requestsOpen: true,
                }}
                priority={index < 2}
                href={`/admin/vue/fiche/${pick.id}`}
              />
              <p className="text-grey text-xs">
                {t("picked", { rank: pick.best_rank, count: pick.visitors })}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
