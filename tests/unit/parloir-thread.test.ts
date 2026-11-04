import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/parloir";
import {
  dayKey,
  dayLabel,
  dayStarts,
  firstUnreadId,
  reconcilePending,
  timeLabel,
  typingDue,
  type Pending,
} from "@/lib/parloir-thread";

const PARIS = "Europe/Paris";

function message(id: number, over: Partial<Message> = {}): Message {
  return {
    id,
    kind: "text",
    mine: false,
    body: `m${id}`,
    payload: null,
    created_at: "2026-11-04T10:00:00Z",
    ...over,
  };
}

describe("times and days", () => {
  it("writes the hour in the member's time zone, 24 h", () => {
    expect(timeLabel("2026-11-04T13:05:00Z", PARIS)).toBe("14:05");
    expect(timeLabel("2026-11-04T23:30:00Z", PARIS)).toBe("00:30");
    expect(timeLabel("2026-11-04T23:30:00Z", "America/New_York")).toBe("18:30");
  });

  it("finds the calendar day in that time zone", () => {
    // 23:30 UTC is already the next day in Paris.
    expect(dayKey("2026-11-04T23:30:00Z", PARIS)).toBe("2026-11-05");
    expect(dayKey("2026-11-04T23:30:00Z", "UTC")).toBe("2026-11-04");
  });

  it("names the day: today, yesterday, then the date", () => {
    const now = Date.parse("2026-11-04T09:00:00Z");
    expect(dayLabel("2026-11-04T06:00:00Z", now, PARIS, "fr")).toEqual({ kind: "today" });
    expect(dayLabel("2026-11-03T20:00:00Z", now, PARIS, "fr")).toEqual({ kind: "yesterday" });
    expect(dayLabel("2026-11-02T12:00:00Z", now, PARIS, "fr")).toEqual({
      kind: "date",
      text: "lundi 2 novembre",
    });
    expect(dayLabel("2026-11-02T12:00:00Z", now, PARIS, "en")).toEqual({
      kind: "date",
      text: "Monday 2 November",
    });
    // Another year: the year is written.
    expect(dayLabel("2025-12-31T12:00:00Z", now, PARIS, "fr")).toEqual({
      kind: "date",
      text: "mercredi 31 décembre 2025",
    });
  });

  it("knows yesterday across a month and a time change", () => {
    // 1 November is the day after 31 October; the clocks went back on 25 October in Paris.
    const now = Date.parse("2026-11-01T08:00:00Z");
    expect(dayLabel("2026-10-31T21:00:00Z", now, PARIS, "fr")).toEqual({ kind: "yesterday" });
    expect(dayLabel("2026-10-31T23:30:00Z", now, PARIS, "fr")).toEqual({ kind: "today" });
  });

  it("puts a separator before the first message of each day", () => {
    const messages = [
      message(1, { created_at: "2026-11-02T08:00:00Z" }),
      message(2, { created_at: "2026-11-02T20:00:00Z" }),
      message(3, { created_at: "2026-11-02T23:30:00Z" }), // already 3 November in Paris
      message(4, { created_at: "2026-11-04T07:00:00Z" }),
    ];
    expect([...dayStarts(messages, PARIS)]).toEqual([1, 3, 4]);
  });
});

describe("« Nouveaux messages »", () => {
  it("goes above the first message of the other not read when opening", () => {
    const messages = [
      message(1, { kind: "system" }),
      message(2, { mine: true }),
      message(3),
      message(4),
    ];
    expect(firstUnreadId(messages, 2)).toBe(3);
    expect(firstUnreadId(messages, 4)).toBeNull();
    // My own messages and the system lines are never « new » for me.
    expect(
      firstUnreadId([message(5, { mine: true }), message(6, { kind: "system" })], 0),
    ).toBeNull();
  });
});

describe("messages shown before the server confirms them", () => {
  const sending = (key: string, body: string, after: number, id?: number): Pending => ({
    key,
    body,
    status: "sending",
    after,
    createdAt: "2026-11-04T10:00:00Z",
    ...(id === undefined ? {} : { id }),
  });

  it("keeps a message until its server copy arrives, then shows it once", () => {
    const pending = [sending("a", "Salut", 10, 11)];
    expect(reconcilePending(pending, [message(10)])).toEqual(pending);
    expect(
      reconcilePending(pending, [message(10), message(11, { mine: true, body: "Salut" })]),
    ).toEqual([]);
  });

  it("recognises a copy that arrives before the confirmation, by its text", () => {
    const pending = [sending("a", "Salut", 10)];
    const copy = message(11, { mine: true, body: "Salut" });
    expect(reconcilePending(pending, [message(10), copy])).toEqual([]);
    // Not a message of the other, not an older one.
    expect(reconcilePending(pending, [message(11, { body: "Salut" })])).toEqual(pending);
    expect(reconcilePending(pending, [message(9, { mine: true, body: "Salut" })])).toEqual(pending);
  });

  it("matches two identical messages one for one", () => {
    const pending = [sending("a", "Oui", 10), sending("b", "Oui", 10)];
    const kept = reconcilePending(pending, [message(11, { mine: true, body: "Oui" })]);
    expect(kept.map((p) => p.key)).toEqual(["b"]);
  });

  it("keeps a failed message, for « Réessayer »", () => {
    const failed: Pending = { ...sending("a", "Salut", 10), status: "failed" };
    expect(reconcilePending([failed], [message(11, { mine: true, body: "Salut" })])).toEqual([
      failed,
    ]);
  });
});

describe("« … écrit »", () => {
  it("is sent at most every 2 s", () => {
    expect(typingDue(0, 1999)).toBe(false);
    expect(typingDue(0, 2000)).toBe(true);
  });
});
