import { CalendarClock } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Stamp } from "@/components/brand/stamp";
import { CancelVisit } from "@/components/relations/cancel-visit";
import { CloseAfterAbsence } from "@/components/relations/close-after-absence";
import { ButtonLink } from "@/components/ui/button-link";
import { requireMember } from "@/lib/auth/user";
import { formatSlot } from "@/lib/hours";
import { loadSchedule, memberTimezone } from "@/lib/relations/schedule";

/**
 * Le Courrier, an accepted request (Bad side): the slots waiting for the Visitor's choice, the
 * scheduled visit (with cancellation), or the invitation to propose new Heures de visite.
 */
export async function ScheduleStatus({
  requestId,
  pseudo,
  sent,
}: {
  requestId: string;
  pseudo: string;
  sent: boolean;
}) {
  const member = await requireMember();
  const [schedule, tz, locale, t] = await Promise.all([
    loadSchedule(member.supabase, requestId),
    memberTimezone(member.supabase, member.userId),
    getLocale(),
    getTranslations("Relations.schedule"),
  ]);
  if (!schedule) return null;
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

  if (schedule.visit) {
    return (
      <section
        aria-labelledby="visit-title"
        className="flex flex-col items-center gap-3 text-center"
      >
        <Stamp kind="visitAccepted" surface="dark" size="md" tilt={-5} />
        <h2 id="visit-title" className="font-display text-xl uppercase">
          {t("scheduled")}
        </h2>
        <p className="text-cream flex items-center gap-2 font-bold">
          <CalendarClock aria-hidden="true" className="text-accent size-5" />
          {formatSlot(new Date(schedule.visit.starts_at), tz, locale)}
        </p>
        <p className="text-grey text-sm">{t("reminder")}</p>
        <CancelVisit visitId={schedule.visit.id} pseudo={pseudo} />
      </section>
    );
  }

  if (schedule.can_propose) {
    const why =
      schedule.round === 0
        ? t("legacy")
        : schedule.can_close_after_absence
          ? t("absent", { pseudo, deadline: deadline(schedule.repropose_deadline) })
          : schedule.slots_declined
            ? t("declined", { pseudo, deadline: deadline(schedule.repropose_deadline) })
            : t("cancelled", { deadline: deadline(schedule.repropose_deadline) });
    return (
      <section className="flex flex-col gap-3 text-center">
        <p className="text-cream/90">{why}</p>
        <ButtonLink href={`/courrier/${requestId}/heures`}>
          {schedule.round === 0 ? t("proposeFirst") : t("propose")}
        </ButtonLink>
        {schedule.can_close_after_absence ? (
          <CloseAfterAbsence requestId={requestId} pseudo={pseudo} />
        ) : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="slots-title" className="flex flex-col gap-3">
      {sent ? (
        <p role="status" className="text-green-bright text-center font-semibold">
          {t("sent", { pseudo })}
        </p>
      ) : null}
      <p className="text-cream/90 text-center">
        {t("waitingChoice", { pseudo, deadline: deadline(schedule.choose_deadline) })}
      </p>
      <h2 id="slots-title" className="text-grey text-[13px] font-semibold">
        {t("yourSlots")}
      </h2>
      <ul className="flex flex-col gap-2">
        {schedule.slots.map((slot) => (
          <li
            key={slot.id}
            className="border-line flex min-h-12 items-center rounded-md border bg-[#0e0e10] px-3.5 font-semibold"
          >
            {formatSlot(new Date(slot.starts_at), tz, locale)}
          </li>
        ))}
      </ul>
    </section>
  );
}
