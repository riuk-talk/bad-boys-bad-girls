import { Check, ChevronLeft, Lock, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Mugshot } from "@/components/brand/mugshot";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { Decision } from "@/components/relations/decision";
import { ScheduleStatus } from "@/components/relations/schedule-status";
import { SafetyActions } from "@/components/relations/safety-actions";
import { accentForGender } from "@/lib/accent";
import { loadPermit, publicPhotoUrl, requireRole } from "@/lib/relations/server";
import { localize, tribeText } from "@/lib/relations/types";

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

      <section
        aria-labelledby="permit-title"
        data-accent={accentForGender(permit.gender)}
        className="bg-cream text-ink flex flex-col gap-3 rounded-md p-4"
      >
        <div className="flex items-center justify-between border-b-2 border-[#cfc4ae] pb-2">
          <span className="font-stamp text-[13px] tracking-[0.15em]">{t("permit")}</span>
          <span className="font-stamp text-green-ink -rotate-3 border-2 border-current px-1.5 py-0.5 text-[11px]">
            {t("deliveredByGreffe")}
          </span>
        </div>
        <div className="flex gap-3.5">
          {photo ? (
            <Mugshot
              src={photo}
              alt={t("photoAlt", { pseudo: permit.pseudo })}
              cutout={permit.photo?.cutout === true}
              priority
              className="h-[136px] w-[110px] shrink-0 rounded-[3px]"
            />
          ) : (
            <div className="relative flex h-[136px] w-[110px] shrink-0 items-end justify-center overflow-hidden rounded-[3px] bg-[#2a2a2e]">
              <UserRound aria-hidden="true" className="text-cream/40 size-24" strokeWidth={1.2} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <h1
              id="permit-title"
              className="font-display text-[28px] leading-none text-[var(--color-accent-ink)] uppercase"
            >
              {permit.age !== null
                ? t("nameAge", { pseudo: permit.pseudo, age: permit.age })
                : permit.pseudo}
            </h1>
            {place ? <span className="text-sm text-[#4a4038]">{place}</span> : null}
            {permit.clean_record ? (
              <span className="text-green-ink inline-flex items-center gap-1.5 text-[13px] font-bold">
                <Check aria-hidden="true" className="size-4" />
                {t("cleanRecord")}
              </span>
            ) : null}
            <span className="text-[13px] font-bold text-[#4a4038]">
              {permit.visits_due > 0
                ? t("honored", { honored: permit.visits_honored, due: permit.visits_due })
                : t("newVisitor")}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-stamp text-xs tracking-[0.15em] text-[#6a5f55]">{t("motive")}</span>
          <p className="text-[15px] leading-normal">{permit.motive}</p>
        </div>
        {permit.tribes.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("signs")}>
            {permit.tribes.map((tribe) => (
              <li
                key={tribeText(tribe, "fr")}
                className="inline-flex min-h-[30px] items-center rounded-full border border-[#cfc4ae] px-2.5 text-xs text-[#4a4038]"
              >
                {tribeText(tribe, locale, permit.gender)}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

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
