"use client";

import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { proposeHoursAction } from "@/app/[locale]/(app)/hours-actions";
import type { ActionState } from "@/app/[locale]/(app)/relations-actions";
import { buttonClasses } from "@/components/ui/button";
import { controlClasses } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  formatShortcut,
  formatSlot,
  startFrom,
  type DayOption,
  type ShortcutKey,
} from "@/lib/hours";

const IDLE: ActionState = { status: "idle" };
const MAX = 3;

type Props = {
  requestId: string;
  mode: "accept" | "repropose";
  pseudo: string;
  tz: string;
  shortcuts: { key: ShortcutKey; start: string | null }[];
  days: DayOption[];
};

/**
 * Les Heures de visite (maquette Heures.dc.html): 2 or 3 slots of 30 minutes, from the shortcuts
 * (« Ce soir », « Demain soir », « Ce week-end », local time of the quartier) or a day and a
 * time of one's own. The database checks every rule again when they are sent.
 */
export function HoursPicker({ requestId, mode, pseudo, tz, shortcuts, days }: Props) {
  const t = useTranslations("Relations.hours");
  const errorT = useTranslations("Relations.errors");
  const locale = useLocale();
  const [state, send, sending] = useActionState(proposeHoursAction, IDLE);
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState(false);
  const [day, setDay] = useState(days[0]?.value ?? "");
  const times = days.find((option) => option.value === day)?.times ?? [];
  const [time, setTime] = useState(times[0] ?? "");

  const add = (iso: string) =>
    setPicked((current) =>
      current.includes(iso) || current.length >= MAX ? current : [...current, iso].sort(),
    );
  const addCustom = () => {
    const start = startFrom(tz, day, time);
    if (start) add(start.toISOString());
  };
  const full = picked.length >= MAX;

  return (
    <form action={send} className="flex flex-col gap-5">
      <input type="hidden" name="request" value={requestId} />
      <input type="hidden" name="mode" value={mode} />
      {picked.map((iso) => (
        <input key={iso} type="hidden" name="slot" value={iso} />
      ))}

      <section className="flex flex-col gap-2.5" aria-labelledby="shortcuts-title">
        <p id="shortcuts-title" className="text-grey text-[13px] font-semibold">
          {t("shortcuts")}
        </p>
        <div className="flex gap-2">
          {shortcuts.map(({ key, start }) => {
            const taken = start !== null && picked.includes(start);
            return (
              <button
                key={key}
                type="button"
                disabled={start === null || taken || full}
                aria-pressed={taken}
                onClick={() => start && add(start)}
                className={cn(
                  "bg-ink-2 text-cream flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 rounded-md border text-sm font-bold disabled:opacity-50",
                  taken ? "border-accent" : "border-line",
                )}
              >
                {t(key)}
                <span className="text-grey text-xs font-normal">
                  {start
                    ? formatShortcut(new Date(start), tz, locale, key === "weekend")
                    : t("unavailable")}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="picked-title">
        <p id="picked-title" className="text-grey text-[13px] font-semibold">
          {t("picked", { count: picked.length })}
        </p>
        <ul className="flex flex-col gap-2">
          {picked.map((iso) => {
            const label = formatSlot(new Date(iso), tz, locale);
            return (
              <li
                key={iso}
                className="border-accent flex min-h-13 items-center justify-between rounded-md border-2 bg-[#1e1013] py-0 pr-1.5 pl-3.5"
              >
                <span className="font-bold">{label}</span>
                <button
                  type="button"
                  onClick={() => setPicked((current) => current.filter((item) => item !== iso))}
                  aria-label={t("remove", { slot: label })}
                  className="text-grey hover:text-cream flex size-11 items-center justify-center"
                >
                  <X aria-hidden="true" className="size-5" />
                </button>
              </li>
            );
          })}
        </ul>
        {custom ? (
          <div className="border-line flex flex-col gap-3 rounded-md border border-dashed p-3">
            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
                {t("day")}
                <select
                  className={controlClasses}
                  value={day}
                  onChange={(event) => {
                    setDay(event.target.value);
                    const next = days.find((option) => option.value === event.target.value);
                    setTime(next?.times[0] ?? "");
                  }}
                >
                  {days.map((option) => (
                    <option key={option.value} value={option.value}>
                      {dayLabel(option.value, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex w-28 flex-col gap-1 text-sm font-semibold">
                {t("time")}
                <select
                  className={controlClasses}
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                >
                  {times.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              onClick={addCustom}
              disabled={full || !time}
              className={buttonClasses("secondary", "md")}
            >
              {t("add")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCustom(true)}
            disabled={full}
            className="text-cream/90 min-h-13 rounded-md border border-dashed border-[#4a4a50] text-sm font-bold disabled:opacity-50"
          >
            {t("addOther")}
          </button>
        )}
      </section>

      <p className="text-grey text-center text-[13px] leading-normal">{t("rules", { pseudo })}</p>
      <p role="alert" className="text-red-bright min-h-5 text-center text-sm">
        {state.status === "error" ? errorT(state.message as "generic") : null}
      </p>
      <button
        type="submit"
        disabled={sending || picked.length < 2}
        className={buttonClasses(
          "primary",
          "lg",
          "font-display w-full rounded-[4px] text-xl uppercase",
        )}
      >
        {sending ? t("sending") : t("send")}
      </button>
      {picked.length < 2 ? <p className="text-grey text-center text-xs">{t("needTwo")}</p> : null}
    </form>
  );
}

/** « mar. 6 oct. » for a local day (YYYY-MM-DD): a calendar date, shown as such (no time zone). */
function dayLabel(value: string, locale: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}
