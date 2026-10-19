"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { chooseEndAction, syncVisitAction } from "@/app/[locale]/(app)/parloir-actions";
import type { ActionState } from "@/app/[locale]/(app)/relations-actions";
import { Stamp } from "@/components/brand/stamp";
import { Chat } from "@/components/parloir/chat";
import { CloseAfterAbsence } from "@/components/relations/close-after-absence";
import { Hygiaphone } from "@/components/parloir/plate";
import { SafetyActions } from "@/components/relations/safety-actions";
import { buttonClasses } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { accentForGender, type Accent } from "@/lib/accent";
import {
  cabinLabel,
  clockOffset,
  countdown,
  visitPhase,
  type Message,
  type Visit,
} from "@/lib/parloir";

const IDLE: ActionState = { status: "idle" };
/** The state of the visit (presence of the other, end, absence) is read every 5 s (SCHEMA visits). */
const VISIT_POLL_MS = 5000;

type Props = {
  initial: Visit;
  messages: Message[];
  me: { pseudo: string; accent: Accent };
  tz: string;
};

/**
 * Parloir · Cabine n° (maquettes Visite.dc.html, FinVisite.dc.html): the waiting screen, the
 * 30 minutes with their countdown, then the secret end choice and its outcome. Opening the screen
 * marks the member present (join_visit); the database clock decides every step.
 */
export function VisitRoom({ initial, messages, me, tz }: Props) {
  const t = useTranslations("Relations.parloir");
  const locale = useLocale();
  const [visit, setVisit] = useState(initial);
  const [offset, setOffset] = useState(() => clockOffset(initial.now, Date.now()));
  const [now, setNow] = useState(() => Date.now() + offset);
  const syncing = useRef(false);

  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const result = await syncVisitAction(initial.id);
      if ("visit" in result) {
        setVisit(result.visit);
        setOffset(clockOffset(result.visit.now, Date.now()));
      }
    } catch {
      // A lost request (network, server restart): the next poll tries again.
    } finally {
      syncing.current = false;
    }
  }, [initial.id]);

  useEffect(() => {
    const poll = window.setInterval(() => void sync(), VISIT_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(tick);
  }, [offset]);

  const phase = visitPhase(visit, now);
  const other = { pseudo: visit.other.pseudo, accent: accentForGender(visit.other.gender) };
  const visitorPseudo = visit.i_am_bad ? other.pseudo : me.pseudo;
  const timeFormat = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });
  const dayFormat = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
  const startsAt = new Date(visit.starts_at);
  const endsAt = Date.parse(visit.ends_at);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-2xl flex-col gap-3 px-4 py-4 sm:px-6">
      <header className="parloir-plate flex flex-col gap-2 rounded-md px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <Hygiaphone />
          <h1 className="font-display text-center text-lg tracking-wide uppercase">
            {t("plate", { cabin: cabinLabel(visit.cabin) })}
          </h1>
          <Hygiaphone />
        </div>
        <SafetyActions
          memberId={visit.other.id}
          pseudo={other.pseudo}
          reportType="visit_request"
          reportTarget={visit.request_id}
          afterBlock="/visites"
        />
      </header>

      {phase === "before" ? (
        <section className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-cream/90">
            {t("startsAt", { pseudo: other.pseudo, time: timeFormat.format(startsAt) })}
          </p>
          <p className="text-grey text-sm">{t("startsIn")}</p>
          <Timer value={countdown(startsAt.getTime() - now)} />
        </section>
      ) : null}

      {phase === "waiting" ? (
        <section className="flex flex-col items-center gap-3 py-8 text-center" role="status">
          <Timer label={t("timeLeft")} value={countdown(endsAt - now)} />
          <p className="font-display text-xl uppercase" data-accent={other.accent}>
            {t("waiting", { pseudo: other.pseudo })}
          </p>
          <p className="text-grey max-w-sm text-sm">{t("waitingHint", { pseudo: other.pseudo })}</p>
        </section>
      ) : null}

      {phase === "live" && visit.conversation_id ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <Timer label={t("timeLeft")} value={countdown(endsAt - now)} />
            {visit.visitor_clean_record ? (
              <Stamp kind="cleanRecord" surface="dark" size="sm" tilt={-4} />
            ) : null}
          </div>
          <p className="font-stamp text-grey text-center text-[11px] tracking-[0.15em]">
            {t("visitLine", {
              date: `${dayFormat.format(startsAt)} · ${timeFormat.format(startsAt)}`.toUpperCase(),
              pseudo: other.pseudo.toUpperCase(),
            })}
          </p>
          {now >= endsAt ? <p className="text-grey text-center text-sm">{t("visitOver")}</p> : null}
          <Chat
            conversationId={visit.conversation_id}
            initial={messages}
            canWrite={now < endsAt}
            me={me}
            other={other}
            visitorPseudo={visitorPseudo}
            iAmVisitor={!visit.i_am_bad}
          />
        </>
      ) : null}

      {phase === "absent" ? (
        <section className="flex flex-col items-center gap-3 py-8 text-center" role="status">
          <p className="font-display text-xl uppercase">
            {visit.absent === "me"
              ? t("absentMe")
              : visit.absent === "both"
                ? t("absentBoth")
                : t("absentOther", { pseudo: other.pseudo })}
          </p>
          {visit.request_status === "accepted" ? (
            <p className="text-grey max-w-sm text-sm">
              {visit.i_am_bad ? t("absentBad") : t("absentVisitor", { pseudo: other.pseudo })}
            </p>
          ) : (
            <p className="text-grey text-sm">{t("closedBody")}</p>
          )}
          {visit.can_propose ? (
            <Link
              href={`/courrier/${visit.request_id}/heures`}
              className={buttonClasses("primary", "md")}
            >
              {t("propose")}
            </Link>
          ) : null}
          {visit.can_propose && visit.i_am_bad && visit.absent !== "me" ? (
            <CloseAfterAbsence requestId={visit.request_id} pseudo={other.pseudo} />
          ) : null}
        </section>
      ) : null}

      {phase === "choose" ? (
        <EndChoice
          visit={visit}
          pseudo={other.pseudo}
          endTime={timeFormat.format(new Date(endsAt))}
          onDone={sync}
        />
      ) : null}

      {phase === "chosen" ? (
        <p className="text-cream/90 py-8 text-center" role="status">
          {t("chosen", {
            deadline: visit.end_choice_deadline
              ? `${dayFormat.format(new Date(visit.end_choice_deadline))} ${timeFormat.format(new Date(visit.end_choice_deadline))}`
              : "",
          })}
        </p>
      ) : null}

      {phase === "released" ? (
        <section className="flex flex-col items-center gap-4 py-8 text-center" role="status">
          <Stamp kind="permanentPermit" surface="dark" size="lg" tilt={-6} animated />
          <p className="text-cream/90">{t("released")}</p>
          {visit.conversation_id ? (
            <Link
              href={`/visites/parloir/${visit.conversation_id}`}
              className={buttonClasses("primary", "lg", "font-display uppercase")}
            >
              {t("openParloir")}
            </Link>
          ) : null}
        </section>
      ) : null}

      {phase === "closed" ? (
        <section className="flex flex-col items-center gap-4 py-8 text-center" role="status">
          <Stamp kind="dismissed" surface="dark" size="lg" tilt={-6} animated />
          <p className="text-cream/90">{t("closedBody")}</p>
        </section>
      ) : null}

      {phase === "cancelled" ? (
        <p className="text-grey py-8 text-center" role="status">
          {t("cancelled")}
        </p>
      ) : null}

      {phase !== "live" ? (
        <Link
          href="/visites"
          className="text-cream self-center text-sm underline underline-offset-4"
        >
          {t("backToVisits")}
        </Link>
      ) : null}
    </div>
  );
}

function Timer({ label, value }: { label?: string; value: string }) {
  return (
    <div className="inline-flex flex-col items-center rounded-md border border-[#2a2a2e] bg-[#08080a] px-3 py-1.5">
      {label ? (
        <span className="font-stamp text-grey text-[10px] tracking-[0.2em]">{label}</span>
      ) : null}
      <span className="font-display text-accent text-2xl tabular-nums" role="timer">
        {value}
      </span>
    </div>
  );
}

function EndChoice({
  visit,
  pseudo,
  endTime,
  onDone,
}: {
  visit: Visit;
  pseudo: string;
  endTime: string;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations("Relations.parloir");
  const errorT = useTranslations("Relations.errors");
  const [state, choose, choosing] = useActionState(chooseEndAction, IDLE);

  useEffect(() => {
    if (state.status === "done") void onDone();
  }, [state.status, onDone]);

  return (
    <section
      aria-labelledby="end-title"
      className="flex flex-col items-center gap-4 py-6 text-center"
    >
      <p className="font-stamp text-grey text-xs tracking-[0.2em]">
        {t("endTitle", { time: endTime })}
      </p>
      <h2 id="end-title" className="font-display text-[28px] leading-tight uppercase">
        {t("endQuestion", { pseudo })}
      </h2>
      <p className="text-cream/90 max-w-md text-[15px]">{t("endLead")}</p>
      <form action={choose} className="flex w-full max-w-sm flex-col gap-2.5">
        <input type="hidden" name="visit" value={visit.id} />
        <button
          type="submit"
          name="choice"
          value="prolong"
          disabled={choosing}
          className={buttonClasses(
            "primary",
            "lg",
            "font-display w-full rounded-[4px] text-xl uppercase",
          )}
        >
          {t("prolong")}
        </button>
        <button
          type="submit"
          name="choice"
          value="close"
          disabled={choosing}
          className="font-display text-cream hover:border-cream flex min-h-12 w-full items-center justify-center rounded-[4px] border-2 border-[#4a4a50] text-[17px] uppercase"
        >
          {t("close")}
        </button>
      </form>
      <p className="text-grey max-w-sm text-xs">{t("endHint")}</p>
      <p role="alert" className="text-red-bright min-h-5 text-sm">
        {state.status === "error" ? errorT(state.message as "generic") : null}
      </p>
    </section>
  );
}
