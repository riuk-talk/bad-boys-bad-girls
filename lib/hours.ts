/**
 * Les Heures de visite (SPEC §7 bis): pure time logic, in the local time of the quartier
 * (launch_zones.timezone, Europe/Paris for now). The database checks the same rules again
 * (accept_visit_request / propose_slots): at least 2 h ahead, within 7 days, on the hour or the
 * half hour, 2 or 3 different slots.
 */

export const SLOT_MINUTES = 30;
export const MIN_LEAD_MS = 2 * 60 * 60 * 1000;
export const MAX_LEAD_MS = 7 * 24 * 60 * 60 * 1000;
const HALF_HOUR_MS = SLOT_MINUTES * 60 * 1000;

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The wall clock of `tz` at `date`. */
export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** The instant when the wall clock of `tz` shows this date and time (DST handled). */
export function zonedTime(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(new Date(guess), tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wanted - shown;
  }
  return new Date(guess);
}

/** Adds whole days to a calendar date (no time zone involved). */
function addDays(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** First possible start: 2 h from now, rounded up to the next hour or half hour. */
export function earliestStart(now: Date): Date {
  return new Date(Math.ceil((now.getTime() + MIN_LEAD_MS) / HALF_HOUR_MS) * HALF_HOUR_MS);
}

export function latestStart(now: Date): Date {
  return new Date(Math.floor((now.getTime() + MAX_LEAD_MS) / HALF_HOUR_MS) * HALF_HOUR_MS);
}

export function isAllowedStart(start: Date, now: Date): boolean {
  return (
    start.getTime() % HALF_HOUR_MS === 0 &&
    start.getTime() >= now.getTime() + MIN_LEAD_MS &&
    start.getTime() <= now.getTime() + MAX_LEAD_MS
  );
}

/**
 * At `hour`:00 that day, or, if that is less than 2 h away, the first possible half hour of
 * the same evening, no later than 23:30; null when nothing is left that day.
 */
function sameEvening(
  now: Date,
  tz: string,
  date: { year: number; month: number; day: number },
  hour: number,
) {
  const wanted = zonedTime(tz, date.year, date.month, date.day, hour, 0);
  if (isAllowedStart(wanted, now)) return wanted;
  const last = zonedTime(tz, date.year, date.month, date.day, 23, 30);
  const first = earliestStart(now);
  return first.getTime() <= last.getTime() && first.getTime() >= wanted.getTime() ? first : null;
}

export type ShortcutKey = "tonight" | "tomorrow" | "weekend";
export type Shortcut = { key: ShortcutKey; start: Date | null };

/**
 * « Ce soir » (21:00), « Demain soir » (21:00 tomorrow), « Ce week-end » (Saturday 18:00; on a
 * Saturday or a Sunday: Sunday 18:00), local time of the quartier (SPEC §7 bis, validated v7).
 * A null start is a greyed-out shortcut.
 */
export function shortcuts(now: Date, tz: string): Shortcut[] {
  const today = zonedParts(now, tz);
  const date = { year: today.year, month: today.month, day: today.day };
  const tomorrow = addDays(date.year, date.month, date.day, 1);
  const tomorrowStart = zonedTime(tz, tomorrow.year, tomorrow.month, tomorrow.day, 21, 0);
  let weekend: Date | null;
  if (today.weekday === 6 || today.weekday === 0) {
    const sunday = addDays(date.year, date.month, date.day, today.weekday === 6 ? 1 : 0);
    weekend = sameEvening(now, tz, sunday, 18);
  } else {
    const saturday = addDays(date.year, date.month, date.day, 6 - today.weekday);
    weekend = zonedTime(tz, saturday.year, saturday.month, saturday.day, 18, 0);
  }
  return [
    { key: "tonight", start: sameEvening(now, tz, date, 21) },
    { key: "tomorrow", start: isAllowedStart(tomorrowStart, now) ? tomorrowStart : null },
    { key: "weekend", start: weekend && isAllowedStart(weekend, now) ? weekend : null },
  ];
}

export type DayOption = { value: string; times: string[] };

/**
 * « Choisir un autre jour et une autre heure »: the days (YYYY-MM-DD, local) from today to
 * 7 days ahead, each with its possible half hours (HH:MM, local).
 */
export function customOptions(now: Date, tz: string): DayOption[] {
  const first = earliestStart(now).getTime();
  const last = latestStart(now).getTime();
  const days = new Map<string, string[]>();
  for (let t = first; t <= last; t += HALF_HOUR_MS) {
    const p = zonedParts(new Date(t), tz);
    const day = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    const time = `${pad(p.hour)}:${pad(p.minute)}`;
    const list = days.get(day) ?? [];
    if (!list.includes(time)) list.push(time);
    days.set(day, list);
  }
  return [...days].map(([value, times]) => ({ value, times }));
}

/** The instant of a day (YYYY-MM-DD) and a time (HH:MM) chosen in the local time of `tz`. */
export function startFrom(tz: string, day: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  return zonedTime(tz, Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2]));
}

/** 2 or 3 slots, all different, each allowed (the database checks the Bad's agenda too). */
export function selectionError(
  starts: Date[],
  now: Date,
): "count" | "duplicate" | "invalid" | null {
  if (starts.length < 2 || starts.length > 3) return "count";
  if (new Set(starts.map((start) => start.getTime())).size !== starts.length) return "duplicate";
  if (starts.some((start) => !isAllowedStart(start, now))) return "invalid";
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** « Mardi 6 oct. · 21:00 – 21:30 » (fr) / « Tuesday 6 Oct · 21:00 – 21:30 » (en). */
export function formatSlot(start: Date, tz: string, locale: string): string {
  const day = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(start);
  const time = (date: Date) => {
    const p = zonedParts(date, tz);
    return `${pad(p.hour)}:${pad(p.minute)}`;
  };
  const end = new Date(start.getTime() + HALF_HOUR_MS);
  const label = day.charAt(0).toUpperCase() + day.slice(1);
  return `${label.replace(",", "")} · ${time(start)} – ${time(end)}`;
}

/** « 21:00 » / « sam. 18:00 » under a shortcut. */
export function formatShortcut(start: Date, tz: string, locale: string, withDay: boolean): string {
  const p = zonedParts(start, tz);
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  if (!withDay) return time;
  const day = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
    timeZone: tz,
    weekday: "short",
  }).format(start);
  return `${day} ${time}`;
}
