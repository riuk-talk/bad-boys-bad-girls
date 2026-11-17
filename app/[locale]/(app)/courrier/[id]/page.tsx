import { ChevronLeft, Lock } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { Decision } from "@/components/relations/decision";
import { PermitLetterCard } from "@/components/relations/permit-letter-card";
import { ScheduleStatus } from "@/components/relations/schedule-status";
import { SafetyActions } from "@/components/relations/safety-actions";
import { loadPermit, publicPhotoUrl, requireRole } from "@/lib/relations/server";
import { localize } from "@/lib/relations/types";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ envoye?: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Relations.letter" });
  return { title: t("metaTitle") };
}

/**
 * Reading a Demande de parloir (SPEC §7, maquette LireDemande.dc.html): the Permis, the
 * complicity, the common points and the note. Never the chosen charge nor the result (rule 14).
 */
export default async function LetterPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { envoye: sent } = await searchParams;
  if (!UUID.test(id)) notFound();
  const { supabase, locale } = await requireRole("bad");
  const { data: mailbox } = await supabase.rpc("get_mailbox");
  const row = (mailbox ?? []).find((entry) => entry.request_id === id);
  if (!row) notFound();
  const permit = await loadPermit(supabase, row.visitor_id);
  if (!permit) notFound();
  const t = await getTranslations("Relations.letter");
  const photo = publicPhotoUrl(supabase, permit.photo?.large);
  const place =
    permit.city && permit.distance_km !== null
      ? t("placeDistance", { city: permit.city, km: permit.distance_km })
      : permit.city;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-2 sm:px-6 sm:py-4">
      <LocalizedLink
        href="/courrier"
        className="text-cream hover:text-accent inline-flex min-h-11 items-center gap-1 self-start text-sm font-semibold"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        {t("back")}
      </LocalizedLink>

      <PermitLetterCard
        permit={permit}
        photo={photo}
        place={place}
        locale={locale}
        headingLevel={1}
        headingId="permit-title"
        priority
      />

      <section
        aria-labelledby="complicity-title"
        className="border-line bg-ink-2 flex flex-col gap-2.5 rounded-md border p-4"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="complicity-title" className="font-display text-[17px] uppercase">
            {t("complicity")}
          </h2>
          <span className="font-display text-accent text-[28px]">
            {permit.complicity !== null ? t("percent", { score: permit.complicity }) : t("unknown")}
          </span>
        </div>
        {permit.common_points.length > 0 ? (
          <ul className="text-cream/90 list-disc pl-5 text-sm leading-relaxed">
            {permit.common_points.map((point) => (
              <li key={localize(point.question, "fr")}>
                {t("commonPoint", {
                  question: localize(point.question, locale),
                  answer: localize(point.answer, locale),
                })}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-grey text-sm">{t("noCommonPoints")}</p>
        )}
      </section>

      <section aria-labelledby="note-title" className="flex flex-col gap-2">
        <h2 id="note-title" className="font-display text-[17px] uppercase">
          {t("note")}
        </h2>
        <p className="text-cream/90 rounded-md bg-[#17171a] p-3.5 text-[15px] leading-normal italic">
          {row.note ? `« ${row.note} »` : t("noNote")}
        </p>
      </section>

      <p className="text-grey flex gap-2 text-[13px] leading-snug">
        <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t("betSecret", { pseudo: permit.pseudo })}
      </p>

      <div className="border-line bg-ink -mx-4 flex flex-col gap-2 border-t p-5 sm:mx-0 sm:rounded-md sm:border">
        {row.status === "accepted" ? (
          <ScheduleStatus requestId={row.request_id} pseudo={permit.pseudo} sent={sent === "1"} />
        ) : (
          <Decision requestId={row.request_id} pseudo={permit.pseudo} />
        )}
        <SafetyActions
          memberId={permit.id}
          pseudo={permit.pseudo}
          reportType="visit_request"
          reportTarget={row.request_id}
          afterBlock="/courrier"
        />
      </div>
    </div>
  );
}
