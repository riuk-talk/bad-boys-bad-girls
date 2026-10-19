"use client";

import { MapPin, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";
import {
  cancelDateAction,
  proposeDateAction,
  respondDateAction,
} from "@/app/[locale]/(app)/cavale-actions";
import type { ActionState } from "@/app/[locale]/(app)/relations-actions";
import { Modal } from "@/components/ui/modal";
import { buttonClasses } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Accent } from "@/lib/accent";
import {
  VENUE_MAX,
  VENUE_TYPES,
  cavaleTimeError,
  looksPrivatePlace,
  type Dates,
  type Proposal,
} from "@/lib/cavale";
import { startFrom, zonedParts } from "@/lib/hours";

const IDLE: ActionState = { status: "idle" };

type Person = { pseudo: string; accent: Accent };

const ERRORS = [
  "date_too_soon",
  "date_too_far",
  "date_pending",
  "date_accepted_exists",
  "date_past",
  "not_yet_wait",
  "venue_invalid",
  "venue_required",
  "date_invalid",
  "not_pending",
  "not_cancellable",
  "not_open",
  "not_found",
  "choice_required",
] as const;

function useErrorText() {
  const t = useTranslations("Relations.cavale.errors");
  return (key: string) =>
    t((ERRORS as readonly string[]).includes(key) ? (key as (typeof ERRORS)[number]) : "generic");
}

function useWhen(tz: string) {
  const locale = useLocale();
  return (iso: string) => {
    const label = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
    return label.charAt(0).toUpperCase() + label.slice(1);
  };
}

/**
 * The pinned card of the Cavale (maquette Permanent.dc.html): the accepted one with its safety
 * reminder and a one-gesture cancellation, or the waiting one with Accepter / Autre chose / Pas
 * encore. Coloured like the person who proposed it.
 */
export function CavaleCard({
  dates,
  me,
  other,
  tz,
  onChange,
  onCounter,
}: {
  dates: Dates;
  me: Person;
  other: Person;
  tz: string;
  onChange: () => void;
  onCounter: (proposal: Proposal) => void;
}) {
  const t = useTranslations("Relations.cavale");
  const when = useWhen(tz);
  const card = dates.accepted ?? dates.pending;
  if (!card) {
    return dates.wait_until ? (
      <p role="status" className="text-grey text-center text-[13px]">
        {t("waitUntil", { date: when(dates.wait_until) })}
      </p>
    ) : null;
  }
  const accepted = dates.accepted !== null;
  const author = card.mine ? me : other;
  const kicker = accepted
    ? t("accepted")
    : card.mine
      ? t("mineWaiting")
      : dates.pending?.countered
        ? t("countered", { pseudo: other.pseudo.toUpperCase() })
        : t("proposedBy", { pseudo: other.pseudo.toUpperCase() });
  return (
    <section
      aria-label={kicker}
      data-accent={author.accent}
      className="border-accent flex flex-col gap-2 rounded-lg border-2 bg-[#120f08] p-3"
    >
      <p className="font-stamp text-accent text-xs tracking-[0.15em]">{kicker}</p>
      <p className="font-display flex items-center gap-1.5 text-xl uppercase">
        <MapPin aria-hidden="true" className="text-accent size-4 shrink-0" />
        {t(`types.${card.venue_type}`)} · {card.venue_name}
      </p>
      <p className="text-cream/90 text-sm">{when(card.starts_at)}</p>
      {card.private_place_warning ? (
        <p className="text-cream flex items-start gap-1.5 text-[13px]">
          <TriangleAlert aria-hidden="true" className="text-accent mt-0.5 size-4 shrink-0" />
          {t("privateWarning")}
        </p>
      ) : null}
      {!accepted && !card.mine ? (
        <Answer proposal={card} onDone={onChange} onCounter={onCounter} />
      ) : null}
      {accepted || card.mine ? (
        <CancelCavale proposal={card} accepted={accepted} pseudo={other.pseudo} onDone={onChange} />
      ) : null}
      <p className="text-grey text-xs leading-relaxed">
        {t("safety")}{" "}
        <Link href="/conseils-securite" className="text-cream underline underline-offset-4">
          {t("safetyLink")}
        </Link>
      </p>
    </section>
  );
}

function Answer({
  proposal,
  onDone,
  onCounter,
}: {
  proposal: Proposal;
  onDone: () => void;
  onCounter: (proposal: Proposal) => void;
}) {
  const t = useTranslations("Relations.cavale");
  const errorText = useErrorText();
  const [state, respond, pending] = useActionState(
    async (previous: ActionState, form: FormData): Promise<ActionState> => {
      const result = await respondDateAction(previous, form);
      if (result.status === "done") onDone();
      return result;
    },
    IDLE,
  );
  return (
    <form action={respond} className="flex flex-col gap-1.5">
      <input type="hidden" name="proposal" value={proposal.id} />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="choice"
          value="accept"
          disabled={pending}
          className={buttonClasses("primary", "md", "flex-1")}
        >
          {t("accept")}
        </button>
        <button
          type="button"
          onClick={() => onCounter(proposal)}
          className="text-cream min-h-11 flex-1 rounded-md border border-[#4a4a50] px-3 text-sm font-semibold"
        >
          {t("other")}
        </button>
        <button
          type="submit"
          name="choice"
          value="not_yet"
          disabled={pending}
          className="text-cream min-h-11 flex-1 rounded-md border border-[#4a4a50] px-3 text-sm font-semibold"
        >
          {t("notYet")}
        </button>
      </div>
      <p role="alert" className="text-red-bright min-h-5 text-sm">
        {state.status === "error" ? errorText(state.message) : null}
      </p>
    </form>
  );
}

function CancelCavale({
  proposal,
  accepted,
  pseudo,
  onDone,
}: {
  proposal: Proposal;
  accepted: boolean;
  pseudo: string;
  onDone: () => void;
}) {
  const t = useTranslations("Relations.cavale");
  const errorText = useErrorText();
  const [state, cancel, cancelling] = useActionState(
    async (previous: ActionState, form: FormData): Promise<ActionState> => {
      const result = await cancelDateAction(previous, form);
      if (result.status === "done") onDone();
      return result;
    },
    IDLE,
  );
  return (
    <form action={cancel} className="flex flex-col gap-1">
      <input type="hidden" name="proposal" value={proposal.id} />
      <button
        type="submit"
        disabled={cancelling}
        className="text-cream self-start text-sm underline underline-offset-4"
      >
        {accepted ? t("cancelAccepted") : t("withdraw")}
      </button>
      {accepted ? <span className="text-grey text-xs">{t("cancelHint", { pseudo })}</span> : null}
      <p role="alert" className="text-red-bright min-h-5 text-sm">
        {state.status === "error" ? errorText(state.message) : null}
      </p>
    </form>
  );
}

/** « Proposer une Cavale » / « Proposer autre chose »: type of place, name, day and time. */
export function CavaleForm({
  open,
  conversationId,
  counter,
  tz,
  onClose,
  onDone,
}: {
  open: boolean;
  conversationId: string;
  counter: Proposal | null;
  tz: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("Relations.cavale");
  const errorText = useErrorText();
  const ids = useId();
  const [state, propose, sending] = useActionState(
    async (previous: ActionState, form: FormData): Promise<ActionState> => {
      const result = await proposeDateAction(previous, form);
      if (result.status === "done") onDone();
      return result;
    },
    IDLE,
  );
  const [venue, setVenue] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [today] = useState(() => {
    const p = zonedParts(new Date(), tz);
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  });

  const start = day && time ? startFrom(tz, day, time) : null;
  const [checkedAt] = useState(() => Date.now());
  const timeError = start ? cavaleTimeError(start, new Date(checkedAt)) : null;
  const warning = looksPrivatePlace(venue);

  return (
    <Modal open={open} onClose={onClose} title={counter ? t("counterTitle") : t("formTitle")}>
      <form action={propose} className="flex flex-col gap-4 px-5 py-4">
        <input type="hidden" name="conversation" value={conversationId} />
        <input type="hidden" name="counter" value={counter?.id ?? ""} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{t("typeLabel")}</legend>
          <div className="flex flex-wrap gap-2">
            {VENUE_TYPES.map((type, index) => (
              <label
                key={type}
                className="has-[:checked]:border-accent has-[:checked]:text-accent border-line flex min-h-11 cursor-pointer items-center rounded-md border px-3 text-sm font-semibold"
              >
                <input
                  type="radio"
                  name="venueType"
                  value={type}
                  defaultChecked={index === 0}
                  className="sr-only"
                />
                {t(`types.${type}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1.5 text-sm font-semibold" htmlFor={`${ids}-venue`}>
          {t("venueLabel")}
          <input
            id={`${ids}-venue`}
            name="venueName"
            required
            minLength={2}
            maxLength={VENUE_MAX}
            value={venue}
            onChange={(event) => setVenue(event.target.value)}
            aria-describedby={`${ids}-venue-hint`}
            className="border-line bg-ink focus:border-accent min-h-12 rounded-md border px-3 font-normal focus:outline-none"
          />
          <span id={`${ids}-venue-hint`} className="text-grey text-xs font-normal">
            {t("venueHint")}
          </span>
        </label>
        {warning ? (
          <p role="status" className="text-cream flex items-start gap-1.5 text-[13px]">
            <TriangleAlert aria-hidden="true" className="text-accent mt-0.5 size-4 shrink-0" />
            {t("privateWarning")}
          </p>
        ) : null}
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1.5 text-sm font-semibold">
            {t("dayLabel")}
            <input
              type="date"
              name="day"
              required
              min={today}
              value={day}
              onChange={(event) => setDay(event.target.value)}
              className="border-line bg-ink focus:border-accent min-h-12 rounded-md border px-3 font-normal focus:outline-none"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm font-semibold">
            {t("timeLabel")}
            <input
              type="time"
              name="time"
              required
              step={900}
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="border-line bg-ink focus:border-accent min-h-12 rounded-md border px-3 font-normal focus:outline-none"
            />
          </label>
        </div>
        {timeError ? (
          <p role="status" className="text-red-bright text-sm">
            {errorText(timeError === "too_soon" ? "date_too_soon" : "date_too_far")}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={sending}
          className={buttonClasses("primary", "lg", "font-display uppercase")}
        >
          {t("submit")}
        </button>
        <p role="alert" className="text-red-bright min-h-5 text-sm">
          {state.status === "error" ? errorText(state.message) : null}
        </p>
      </form>
    </Modal>
  );
}
