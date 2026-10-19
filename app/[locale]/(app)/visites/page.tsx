import { CalendarClock, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Stamp } from "@/components/brand/stamp";
import { FreshOnReturn } from "@/components/app/fresh-on-return";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { CancelVisit } from "@/components/relations/cancel-visit";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { accentForGender } from "@/lib/accent";
import { formatSlot } from "@/lib/hours";
import { memberTimezone } from "@/lib/relations/schedule";
import { publicPhotoUrl, requireRole } from "@/lib/relations/server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Relations.visits" });
  return { title: t("metaTitle") };
}

/**
 * Le Tableau des visites (Phase 5b, 5c): the visits of both roles in the local time of the
 * quartier (cancellable until they start, a way into the cabin, the end choice waiting), then the
 * Parloirs sans horaire (Permis permanent).
 */
export default async function VisitsPage() {
  const { supabase, userId, locale } = await requireRole();
  const [t, tz, { data: visits }, { data: parloirs }, { data: counts }] = await Promise.all([
    getTranslations("Relations.visits"),
    memberTimezone(supabase, userId),
    supabase.rpc("get_my_visits"),
    supabase.rpc("get_my_parloirs"),
    supabase.rpc("get_unread_counts"),
    supabase.rpc("mark_notifications_read", {
      p_types: [
        "slot_chosen",
        "visit_cancelled",
        "visit_reminder_1h",
        "visit_starting",
        "visit_no_show",
        "visit_released",
        "visit_closed",
      ],
    }),
  ]);
  const rows = visits ?? [];
  const open = parloirs ?? [];
  const unread = new Map((counts ?? []).map((row) => [row.conversation_id, row.unread]));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6">
      <FreshOnReturn />
      <h1 className="font-display text-center text-3xl uppercase">{t("title")}</h1>
      {rows.length === 0 && open.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-8" />}
          title={t("emptyTitle")}
          body={t("emptyBody")}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((visit) => {
            const url = publicPhotoUrl(supabase, visit.other_photo_small);
            return (
              <li
                key={visit.visit_id}
                data-accent={accentForGender(visit.other_gender)}
                className="border-line bg-ink-2 flex flex-col gap-3 rounded-md border p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="relative flex size-11 shrink-0 items-end justify-center overflow-hidden rounded-full bg-[#1c1c20]">
                    {url ? (
                      <Image
                        src={url}
                        alt=""
                        fill
                        sizes="44px"
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <UserRound
                        aria-hidden="true"
                        className="text-cream/30 size-9"
                        strokeWidth={1.2}
                      />
                    )}
                  </div>
                  <div>
                    <p className="text-cream flex items-center gap-2 font-bold">
                      <CalendarClock aria-hidden="true" className="text-accent size-5" />
                      {formatSlot(new Date(visit.starts_at), tz, locale)}
                    </p>
                    <p className="text-grey text-sm">{t("with", { pseudo: visit.other_pseudo })}</p>
                  </div>
                </div>
                {visit.status === "in_progress" || visit.status === "ended" ? (
                  <ButtonLink href={`/visites/${visit.visit_id}`}>
                    {visit.status === "ended" ? t("waitingChoice") : t("enter")}
                  </ButtonLink>
                ) : (
                  <LocalizedLink
                    href={`/visites/${visit.visit_id}`}
                    className="text-cream self-start text-sm underline underline-offset-4"
                  >
                    {t("enter")}
                  </LocalizedLink>
                )}
                {visit.status === "scheduled" ? (
                  <CancelVisit visitId={visit.visit_id} pseudo={visit.other_pseudo} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {open.length > 0 ? (
        <section aria-labelledby="parloirs-title" className="flex flex-col gap-2.5">
          <h2 id="parloirs-title" className="font-display text-lg uppercase">
            {t("parloirsTitle")}
          </h2>
          <ul className="flex flex-col gap-2">
            {open.map((parloir) => (
              <li key={parloir.conversation_id}>
                <LocalizedLink
                  href={`/visites/parloir/${parloir.conversation_id}`}
                  data-accent={accentForGender(parloir.other_gender)}
                  className="border-line hover:border-accent flex min-h-14 items-center justify-between gap-3 rounded-md border px-3.5 py-2.5"
                >
                  <span className="font-bold">
                    {t("permanent", { pseudo: parloir.other_pseudo })}
                  </span>
                  {(unread.get(parloir.conversation_id) ?? 0) > 0 ? (
                    <span className="bg-accent text-ink rounded-full px-2 text-xs leading-5 font-bold">
                      {t("unread", { count: unread.get(parloir.conversation_id) ?? 0 })}
                    </span>
                  ) : (
                    <Stamp kind="permanentPermit" surface="dark" size="sm" tilt={-4} />
                  )}
                </LocalizedLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
