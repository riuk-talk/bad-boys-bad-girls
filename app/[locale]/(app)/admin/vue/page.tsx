import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { BadCardData } from "@/components/relations/bad-card";
import { DossierCard } from "@/components/relations/dossier-card";
import { Link } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { publicPhotoUrl } from "@/lib/relations/server";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ after?: string; id?: string }>;
};

const PAGE = 48;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "GreffeView" });
  return { title: t("discoverTitle") };
}

/**
 * La Découverte as the Greffe (10a): every Bad a Visitor could find, whatever their criteria and
 * quartier, newest first. Read only (admin_view_discover writes nothing).
 */
export default async function GreffeDiscoverPage({ searchParams }: Props) {
  const member = await requireMember();
  const t = await getTranslations("GreffeView");
  const { after, id } = await searchParams;
  const cursorDate = after && !Number.isNaN(Date.parse(after)) ? after : undefined;
  const cursorId = id && UUID.test(id) ? id : undefined;
  const { data: rows, error } = await member.supabase.rpc("admin_view_discover", {
    p_cursor_created: cursorDate,
    p_cursor_id: cursorDate ? cursorId : undefined,
    p_limit: PAGE,
  });
  if (error) notFound();
  const list = rows ?? [];
  const bads: (BadCardData & { zone: string | null })[] = list.map((row) => ({
    id: row.id,
    pseudo: row.pseudo,
    gender: row.gender,
    age: row.age,
    city: row.city,
    distanceKm: null,
    photoUrl: publicPhotoUrl(member.supabase, row.photo_small),
    complicity: null,
    goodConduct: row.good_conduct,
    requestsOpen: row.requests_open,
    zone: row.zone_name,
  }));
  const last = list.at(-1);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <div className="space-y-1">
        <h1 className="font-display text-3xl tracking-wide uppercase">{t("discoverTitle")}</h1>
        <p className="text-cream/85 text-sm">{t("discoverLead")}</p>
      </div>
      {bads.length === 0 ? (
        <p className="text-grey">{t("discoverEmpty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {bads.map((bad, index) => (
            <li key={bad.id} className="space-y-1">
              <DossierCard bad={bad} priority={index < 2} href={`/admin/vue/fiche/${bad.id}`} />
              <p className="text-grey text-xs">{bad.zone ?? t("noZone")}</p>
            </li>
          ))}
        </ul>
      )}
      {last && list.length === PAGE ? (
        <p>
          <Link
            href={`/admin/vue?after=${encodeURIComponent(last.created_at)}&id=${last.id}`}
            className="text-accent inline-flex min-h-11 items-center underline underline-offset-4"
          >
            {t("more")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
