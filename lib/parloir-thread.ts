import type { Message } from "@/lib/parloir";

/**
 * The thread of the Parloir (9l, owner's decision 2026-11-04), pure and testable: the time under
 * each message and the day separators in the member's time zone, the « Nouveaux messages » mark,
 * the messages shown before the server confirms them, and the pace of the « … écrit » signal.
 */

/** How far each member had read when the conversation was opened (get_read_state). */
export type ReadState = { myReadId: number; otherReadId: number };

/** « … écrit » is sent at most every 2 s while typing, and goes after 5 s without a keystroke. */
export const TYPING_SEND_MS = 2000;
export const TYPING_SHOWN_MS = 5000;

/** The calendar day of an instant in a time zone: « 2026-11-04 ». */
export function dayKey(iso: string | number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** The day before a calendar day (« 2026-11-01 » → « 2026-10-31 »), whatever the time zone. */
function previousDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) - 1));
  return date.toISOString().slice(0, 10);
}

export type DayLabel = { kind: "today" } | { kind: "yesterday" } | { kind: "date"; text: string };

/** « Aujourd'hui », « Hier », or « lundi 2 novembre » (with the year when it is not this one). */
export function dayLabel(iso: string, now: number, tz: string, locale: string): DayLabel {
  const key = dayKey(iso, tz);
  const today = dayKey(now, tz);
  if (key === today) return { kind: "today" };
  if (key === previousDay(today)) return { kind: "yesterday" };
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  const text = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(new Date(iso));
  return { kind: "date", text };
}

/** « 14:05 »: hours and minutes, 24 h, in the member's time zone. */
export function timeLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** Where a day separator goes: before the first message of each calendar day. */
export function dayStarts(messages: readonly Pick<Message, "id" | "created_at">[], tz: string) {
  const starts = new Set<number>();
  let previous = "";
  for (const message of messages) {
    const key = dayKey(message.created_at, tz);
    if (key !== previous) starts.add(message.id);
    previous = key;
  }
  return starts;
}

/**
 * « Nouveaux messages » goes above the first message of the other that the member had not read
 * when the conversation was opened (how far they had read, before this opening marks it read).
 */
export function firstUnreadId(messages: readonly Message[], myReadId: number): number | null {
  const first = messages.find((m) => m.kind === "text" && !m.mine && m.id > myReadId);
  return first ? first.id : null;
}

/** A message shown at once, before the server confirms it (or after it failed). */
export type Pending = {
  /** Local key, never a message id. */
  key: string;
  body: string;
  status: "sending" | "failed";
  /** The id of the message once the server confirmed it. */
  id?: number;
  /** The newest message known when it was sent: the server copy can only come after it. */
  after: number;
  createdAt: string;
};

/**
 * The pending messages still to show: the server copy of a confirmed one replaces it (by id),
 * and a copy that arrives before the confirmation (a realtime refresh racing the request) is
 * matched by its text, so a message never shows twice.
 */
export function reconcilePending(pending: readonly Pending[], messages: readonly Message[]) {
  const ids = new Set(messages.map((m) => m.id));
  const claimed = new Set(pending.flatMap((p) => (p.id === undefined ? [] : [p.id])));
  const kept: Pending[] = [];
  for (const item of pending) {
    if (item.id !== undefined) {
      if (!ids.has(item.id)) kept.push(item);
      continue;
    }
    if (item.status === "sending") {
      const copy = messages.find(
        (m) =>
          m.mine &&
          m.kind === "text" &&
          m.id > item.after &&
          m.body === item.body &&
          !claimed.has(m.id),
      );
      if (copy) {
        claimed.add(copy.id);
        continue;
      }
    }
    kept.push(item);
  }
  return kept;
}

/** Whether a new « … écrit » signal may go now (at most one every 2 s). */
export function typingDue(lastSent: number, now: number): boolean {
  return now - lastSent >= TYPING_SEND_MS;
}
