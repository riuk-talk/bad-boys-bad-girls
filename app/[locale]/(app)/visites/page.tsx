import { CalendarClock, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { CancelVisit } from "@/components/relations/cancel-visit";
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
 * Le Tableau des visites (Phase 5b): the scheduled visits of both roles, in the local time of
 * the quartier, each one cancellable until it starts. The Parloir itself comes in Phase 5c.
 */
export default async function VisitsPage() {
  const { supabase, userId, locale } = await requireRole();
  const [t, tz, { data: visits }] = await Promise.all([
    getTranslations("Relations.visits"),
    memberTimezone(supabase, userId),
    supabase.rpc("get_my_visits"),
    supabase.rpc("mark_notifications_read", {
      p_types: ["slot_chosen", "visit_cancelled", "visit_reminder_1h", "visit_starting"],
    }),
  ]);
  const rows = visits ?? [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6">
      <h1 className="font-display text-center text-3xl uppercase">{t("title")}</h1>
      {rows.length === 0 ? (
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
                {visit.status === "scheduled" ? (
                  <CancelVisit visitId={visit.visit_id} pseudo={visit.other_pseudo} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
