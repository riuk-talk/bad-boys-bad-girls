import { describe, expect, it } from "vitest";
import {
  customOptions,
  earliestStart,
  formatSlot,
  isAllowedStart,
  selectionError,
  shortcuts,
  startFrom,
  zonedParts,
  zonedTime,
} from "@/lib/hours";

const TZ = "Europe/Paris";
const paris = (y: number, mo: number, d: number, h: number, mi = 0) =>
  zonedTime(TZ, y, mo, d, h, mi);
const local = (date: Date | null) => {
  if (!date) return null;
  const p = zonedParts(date, TZ);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};
const keyed = (now: Date) =>
  Object.fromEntries(shortcuts(now, TZ).map((s) => [s.key, local(s.start)]));

describe("zoned time (Europe/Paris)", () => {
  it("round-trips local wall clock times, summer and winter", () => {
    expect(paris(2026, 10, 6, 21).toISOString()).toBe("2026-10-06T19:00:00.000Z");
    expect(paris(2026, 12, 6, 21).toISOString()).toBe("2026-12-06T20:00:00.000Z");
    expect(local(paris(2026, 10, 25, 18))).toBe("2026-10-25 18:00"); // the night of the change
  });
});

describe("shortcuts (SPEC §7 bis)", () => {
  it("on a Tuesday afternoon: tonight 21:00, tomorrow 21:00, Saturday 18:00", () => {
    expect(keyed(paris(2026, 10, 6, 15))).toEqual({
      tonight: "2026-10-06 21:00",
      tomorrow: "2026-10-07 21:00",
      weekend: "2026-10-10 18:00",
    });
  });

  it("21:00 less than 2 h away: the first possible half hour that evening", () => {
    expect(keyed(paris(2026, 10, 6, 19, 40)).tonight).toBe("2026-10-06 22:00");
    expect(keyed(paris(2026, 10, 6, 21, 15)).tonight).toBe("2026-10-06 23:30");
  });

  it("nothing left tonight after 21:30: « Ce soir » is greyed out", () => {
    expect(keyed(paris(2026, 10, 6, 21, 45)).tonight).toBeNull();
    expect(keyed(paris(2026, 10, 6, 23, 0)).tonight).toBeNull();
  });

  it("on a Saturday or a Sunday, the week-end means Sunday 18:00 (same 2 h rule)", () => {
    expect(keyed(paris(2026, 10, 10, 12)).weekend).toBe("2026-10-11 18:00");
    expect(keyed(paris(2026, 10, 11, 10)).weekend).toBe("2026-10-11 18:00");
    expect(keyed(paris(2026, 10, 11, 17)).weekend).toBe("2026-10-11 19:00");
    expect(keyed(paris(2026, 10, 11, 22)).weekend).toBeNull();
  });

  it("every shortcut given is a start the database accepts", () => {
    for (let hour = 0; hour < 24 * 7; hour += 1) {
      const now = new Date(paris(2026, 10, 5, 0).getTime() + hour * 3600_000 + 17 * 60_000);
      for (const s of shortcuts(now, TZ))
        if (s.start) expect(isAllowedStart(s.start, now)).toBe(true);
    }
  });
});

describe("custom day and time", () => {
  const now = paris(2026, 10, 6, 15, 10);

  it("starts 2 h ahead on a half hour, ends 7 days ahead", () => {
    expect(local(earliestStart(now))).toBe("2026-10-06 17:30");
    const days = customOptions(now, TZ);
    expect(days[0]).toEqual(expect.objectContaining({ value: "2026-10-06" }));
    expect(days[0]?.times[0]).toBe("17:30");
    expect(days.at(-1)?.value).toBe("2026-10-13");
    expect(days.at(-1)?.times.at(-1)).toBe("15:00");
  });

  it("reads a local day and time back into an instant", () => {
    expect(local(startFrom(TZ, "2026-10-09", "19:30"))).toBe("2026-10-09 19:30");
    expect(startFrom(TZ, "09/10/2026", "19:30")).toBeNull();
  });
});

describe("selection", () => {
  const now = paris(2026, 10, 6, 15);
  it("2 or 3 different allowed slots", () => {
    const a = paris(2026, 10, 6, 21);
    const b = paris(2026, 10, 7, 21);
    expect(selectionError([a], now)).toBe("count");
    expect(selectionError([a, a], now)).toBe("duplicate");
    expect(selectionError([a, paris(2026, 10, 6, 16)], now)).toBe("invalid");
    expect(selectionError([a, paris(2026, 10, 14, 21)], now)).toBe("invalid");
    expect(selectionError([a, b], now)).toBeNull();
    expect(selectionError([a, b, paris(2026, 10, 10, 18)], now)).toBeNull();
  });
});

describe("display", () => {
  it("formats a slot in French and English", () => {
    expect(formatSlot(paris(2026, 10, 6, 21), TZ, "fr")).toBe("Mardi 6 oct. · 21:00 – 21:30");
    expect(formatSlot(paris(2026, 10, 10, 18), TZ, "en")).toBe("Saturday 10 Oct · 18:00 – 18:30");
  });
});
