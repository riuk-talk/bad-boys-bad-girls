import { describe, expect, it } from "vitest";
import {
  announcedMinutes,
  cabinLabel,
  clockOffset,
  countdown,
  mergeMessages,
  messageSchema,
  readMarkFor,
  totalUnread,
  visitPhase,
  visitSchema,
  type Message,
  type Visit,
} from "@/lib/parloir";

const START = Date.parse("2026-10-20T19:00:00Z");
const END = START + 30 * 60_000;

function visit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: "v",
    request_id: "r",
    status: "scheduled",
    starts_at: new Date(START).toISOString(),
    ends_at: new Date(END).toISOString(),
    now: new Date(START).toISOString(),
    cabin: 3,
    i_am_bad: false,
    other: { id: "o", pseudo: "Lune", gender: "woman", photo_small: null },
    me_present: false,
    other_present: false,
    absent: null,
    visitor_clean_record: true,
    visitor_honored: 0,
    visitor_due: 0,
    end_choice_deadline: null,
    my_choice: null,
    outcome: null,
    conversation_id: null,
    conversation_status: null,
    request_status: "accepted",
    can_propose: false,
    ...overrides,
  };
}

describe("visitPhase", () => {
  it("before the start, then waiting for the other one, then live", () => {
    expect(visitPhase(visit(), START - 1000)).toBe("before");
    expect(visitPhase(visit(), START + 1000)).toBe("waiting");
    expect(visitPhase(visit({ status: "in_progress", me_present: true }), START + 1000)).toBe(
      "waiting",
    );
    expect(
      visitPhase(
        visit({ status: "in_progress", me_present: true, other_present: true }),
        START + 1000,
      ),
    ).toBe("live");
  });

  it("absence, end choice, outcome, cancellation", () => {
    expect(visitPhase(visit({ status: "no_show", absent: "other" }), END)).toBe("absent");
    expect(visitPhase(visit({ status: "ended" }), END)).toBe("choose");
    expect(visitPhase(visit({ status: "ended", my_choice: "prolong" }), END)).toBe("chosen");
    expect(visitPhase(visit({ status: "ended", outcome: "released" }), END)).toBe("released");
    expect(visitPhase(visit({ status: "ended", outcome: "closed" }), END)).toBe("closed");
    expect(visitPhase(visit({ status: "cancelled" }), START)).toBe("cancelled");
  });
});

describe("countdown and clock", () => {
  it("formats the time left, never negative", () => {
    expect(countdown(24 * 60_000 + 12_000)).toBe("24:12");
    expect(countdown(999)).toBe("00:01");
    expect(countdown(-5000)).toBe("00:00");
    expect(countdown(2 * 3600_000 + 5 * 60_000)).toBe("2:05:00");
  });

  it("follows the database clock", () => {
    expect(clockOffset("2026-10-20T19:00:10Z", START)).toBe(10_000);
  });

  it("cabin numbers on two digits", () => {
    expect(cabinLabel(3)).toBe("03");
    expect(cabinLabel(17)).toBe("17");
  });
});

describe("messages", () => {
  const message = (id: number, body = "x"): Message => ({
    id,
    kind: "text",
    mine: false,
    body,
    payload: null,
    created_at: "2026-10-20T19:01:00Z",
  });

  it("merges a poll and a realtime event without duplicates, in order", () => {
    const merged = mergeMessages([message(1), message(3)], [message(2), message(3, "y")]);
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(merged[2]?.body).toBe("y");
  });

  it("reads the bet, the note and the marks", () => {
    expect(
      messageSchema.safeParse({
        ...message(1),
        kind: "system",
        body: null,
        payload: { type: "bet", charge: "A", correct: false, true_charge: "B" },
      }).success,
    ).toBe(true);
    expect(
      messageSchema.safeParse({
        ...message(2),
        kind: "system",
        payload: { type: "note", text: "Salut" },
      }).success,
    ).toBe(true);
    expect(
      messageSchema.safeParse({ ...message(3), kind: "system", payload: { type: "other" } })
        .success,
    ).toBe(false);
  });

  it("parses a visit as get_visit returns it", () => {
    expect(visitSchema.safeParse(visit({ status: "in_progress" })).success).toBe(true);
  });
});

describe("read and unread (Phase 6a)", () => {
  const text = (id: number, mine: boolean): Message => ({
    id,
    kind: "text",
    mine,
    body: "x",
    payload: null,
    created_at: "2026-10-20T19:01:00Z",
  });

  it("« Lu » goes under my last message only, once the other has read it", () => {
    const messages = [text(1, true), text(2, false), text(3, true), text(4, false)];
    expect(readMarkFor(messages, 2)).toBeNull();
    expect(readMarkFor(messages, 3)).toBe(3);
    expect(readMarkFor(messages, 9)).toBe(3);
    expect(readMarkFor([text(1, false)], 9)).toBeNull();
    expect(readMarkFor([], 0)).toBeNull();
  });

  it("the system messages never carry « Lu »", () => {
    const system: Message = { ...text(5, true), kind: "system", payload: { type: "released" } };
    expect(readMarkFor([text(1, true), system], 9)).toBe(1);
  });

  it("adds the unread messages of every Parloir", () => {
    expect(totalUnread([{ unread: 2 }, { unread: 0 }, { unread: 3 }])).toBe(5);
    expect(totalUnread([])).toBe(0);
  });
});

describe("announcedMinutes", () => {
  it("speaks at 20, 10, 5 and 1 minute, and stays silent in between", () => {
    const min = 60_000;
    expect(announcedMinutes(30 * min)).toBeNull();
    expect(announcedMinutes(20 * min + 1)).toBeNull();
    expect(announcedMinutes(20 * min)).toBe(20);
    expect(announcedMinutes(12 * min)).toBe(20);
    expect(announcedMinutes(10 * min)).toBe(10);
    expect(announcedMinutes(7 * min + 30_000)).toBe(10);
    expect(announcedMinutes(5 * min)).toBe(5);
    expect(announcedMinutes(61_000)).toBe(5);
    expect(announcedMinutes(60_000)).toBe(1);
    expect(announcedMinutes(1)).toBe(1);
    // The text stays the same for every second of a stretch: one announcement per milestone.
    const seen = new Set<number | null>();
    for (let ms = 30 * min; ms > 0; ms -= 1000) seen.add(announcedMinutes(ms));
    expect([...seen]).toEqual([null, 20, 10, 5, 1]);
  });
});
