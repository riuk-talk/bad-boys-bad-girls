import { CalendarClock, Lightbulb, Send, UserRound } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Stamp } from "@/components/brand/stamp";
import { PushPrompt } from "@/components/push/push-prompt";
import { CancelVisit } from "@/components/relations/cancel-visit";
import { SlotChooser } from "@/components/relations/slot-chooser";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { accentForGender } from "@/lib/accent";
import { cn } from "@/lib/cn";
import { formatSlot } from "@/lib/hours";
import { loadSchedule, memberTimezone } from "@/lib/relations/schedule";
import { publicPhotoUrl, requireRole } from "@/lib/relations/server";
import type { RequestStatus } from "@/lib/relations/types";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Relations.myRequests" });
  return { title: t("title") };
}

/** Advice shown after 3 cases dismissed in a row (SPEC §7): from the Visitor's own Permis only. */
const SHORT_MOTIVE = 80;
const ALL_QUESTIONS = 20;

const STATUS_TONE: Record<RequestStatus, string> = {
  pending: "text-accent",
  accepted: "text-green-bright",
  released: "text-green-bright",
  dismissed: "text-grey",
  auto_dismissed: "text-grey",
  cancelled: "text-grey",
  closed: "text-grey",
};

/** Mes demandes de parloir (maquette MesDemandes.dc.html), with the Heures de visite (Phase 5b). */
export default async function MyRequestsPage() {
  const { supabase, userId, locale, profile } = await requireRole("visitor");
  const t = await getTranslations("Relations.myRequests");
  const [{ data: requests }, { count: answered }, , { data: prefs }] = await Promise.all([
    supabase.rpc("get_my_requests"),
    supabase
      .from("answers")
      .select("question_id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase.rpc("mark_notifications_read", {
      p_types: ["request_accepted", "request_dismissed", "slots_reproposed", "visit_cancelled"],
    }),
    supabase
      .from("notification_preferences")
      .select("push_prompt_declined_at")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const rows = requests ?? [];
  const accepted = rows.filter((row) => row.status === "accepted");
  // Les Heures de visite of each accepted request (Phase 5b), in the local time of the quartier.
  const [tz, s, scheduleList] = await Promise.all([
    memberTimezone(supabase, userId),
    getTranslations("Relations.schedule"),
    Promise.all(accepted.map((row) => loadSchedule(supabase, row.request_id))),
  ]);
  const schedules = new Map(accepted.map((row, index) => [row.request_id, scheduleList[index]]));
  const deadline = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
          timeZone: tz,
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(iso))
      : "";
  const others = rows.filter((row) => row.status !== "accepted");
  const dateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" });
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const today = new Date();
  const daysAgo = (iso: string) =>
    relative.format(
      -Math.max(0, Math.floor((today.getTime() - new Date(iso).getTime()) / 86400000)),
      "day",
    );

  const advice: string[] = [];
  if ((profile.consecutive_dismissals ?? 0) >= 3) {
    if ((profile.visit_motive ?? "").length < SHORT_MOTIVE) advice.push(t("adviceMotive"));
    if ((answered ?? 0) < ALL_QUESTIONS) advice.push(t("adviceQuestions"));
    advice.push(t("adviceNote"));
    advice.push(t("adviceCasier"));
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="text-center">
        <p className="font-stamp text-accent text-xs tracking-[0.25em]">{t("eyebrow")}</p>
        <h1 className="sr-only">{t("title")}</h1>
      </header>

      {/* Notifications are offered after the first request sent, never on arrival. */}
      {rows.length > 0 ? <PushPrompt declinedAt={prefs?.push_prompt_declined_at ?? null} /> : null}

      {advice.length > 0 ? (
        <section
          aria-labelledby="advice-title"
          className="border-line bg-ink-2 flex flex-col gap-2 rounded-md border p-4"
        >
          <h2 id="advice-title" className="font-display flex items-center gap-2 text-lg uppercase">
            <Lightbulb aria-hidden="true" className="text-accent size-5" />
            {t("adviceTitle")}
          </h2>
          <p className="text-grey text-sm">{t("adviceLead")}</p>
          <ul className="text-cream/90 list-disc space-y-1 pl-5 text-sm">
            {advice.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <LocalizedLink
            href="/ma-fiche"
            className="text-cream self-start text-sm underline underline-offset-4"
          >
            {t("adviceLink")}
          </LocalizedLink>
        </section>
      ) : null}

      {accepted.map((row) => {
        const schedule = schedules.get(row.request_id) ?? null;
        const name = (chunks: ReactNode) => <span className="text-accent">{chunks}</span>;
        const choosing =
          schedule && !schedule.visit && schedule.choose_deadline && schedule.slots.length > 0;
        return (
          <section
            key={row.request_id}
            aria-label={row.pseudo}
            data-accent={accentForGender(row.gender)}
            className="border-line bg-ink-2 relative flex flex-col gap-3 rounded-md border p-4"
          >
            <span className="absolute -top-3 right-3.5">
              <Stamp kind="visitAccepted" surface="dark" size="sm" tilt={-5} />
            </span>
            <div className="flex items-center gap-3">
              <Avatar url={publicPhotoUrl(supabase, row.photo_small)} />
              <div>
                <p className="font-bold">
                  {schedule?.visit
                    ? s.rich("scheduledWith", { pseudo: row.pseudo, name })
                    : s.rich("opensParloir", { pseudo: row.pseudo, name })}
                </p>
                {choosing ? (
                  <p className="text-grey text-[13px]">
                    {s("chooseBefore", { deadline: deadline(schedule.choose_deadline) })}
                  </p>
                ) : null}
              </div>
            </div>
            {schedule?.visit ? (
              <>
                <p className="text-cream flex items-center gap-2 font-bold">
                  <CalendarClock aria-hidden="true" className="text-accent size-5" />
                  {formatSlot(new Date(schedule.visit.starts_at), tz, locale)}
                </p>
                <p className="text-grey text-sm">{s("reminder")}</p>
                <CancelVisit visitId={schedule.visit.id} pseudo={row.pseudo} />
              </>
            ) : choosing ? (
              <>
                <h2 className="font-display text-xl uppercase">{s("hoursTitle")}</h2>
                <SlotChooser
                  requestId={row.request_id}
                  pseudo={row.pseudo}
                  tz={tz}
                  slots={schedule.slots}
                  canDecline={!schedule.slots_declined}
                />
              </>
            ) : schedule?.repropose_deadline ? (
              <p className="text-grey text-sm">
                {s("waitingNew", {
                  pseudo: row.pseudo,
                  deadline: deadline(schedule.repropose_deadline),
                })}
              </p>
            ) : (
              <p className="text-grey text-sm">{t("acceptedNext")}</p>
            )}
          </section>
        );
      })}

      {others.length > 0 ? (
        <ul>
          {others.map((row) => {
            const cooldown = row.cooldown_until ? new Date(row.cooldown_until) : null;
            const closed =
              row.status === "dismissed" ||
              row.status === "auto_dismissed" ||
              row.status === "closed";
            return (
              <li
                key={row.request_id}
                className="flex items-center gap-3 border-t border-[#222226] py-3"
              >
                <Avatar url={publicPhotoUrl(supabase, row.photo_small)} />
                <div className="min-w-0 flex-1" data-accent={accentForGender(row.gender)}>
                  <p className="font-bold">{row.pseudo}</p>
                  <p className="text-grey text-[13px]">
                    {closed
                      ? t("dismissedMessage")
                      : row.status === "cancelled"
                        ? t("cancelledMessage")
                        : t("filed", { when: daysAgo(row.created_at) })}
                  </p>
                  {closed && cooldown && cooldown > new Date() ? (
                    <p className="text-grey text-xs">
                      {t("cooldown", { date: dateFormat.format(cooldown) })}
                    </p>
                  ) : null}
                </div>
                <span
                  className={cn("text-xs font-bold whitespace-nowrap", STATUS_TONE[row.status])}
                >
                  {t(`status_${row.status}`)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Send className="size-8" />}
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={<ButtonLink href="/promenade">{t("toPromenade")}</ButtonLink>}
        />
      ) : null}
    </div>
  );
}

function Avatar({ url }: { url: string | null }) {
  return (
    <div className="relative flex size-11 shrink-0 items-end justify-center overflow-hidden rounded-full bg-[#1c1c20]">
      {url ? (
        <Image src={url} alt="" fill sizes="44px" unoptimized className="object-cover" />
      ) : (
        <UserRound aria-hidden="true" className="text-cream/30 size-9" strokeWidth={1.2} />
      )}
    </div>
  );
}
