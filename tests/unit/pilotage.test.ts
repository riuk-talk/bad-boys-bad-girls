import { describe, expect, it } from "vitest";
import { healthPeriod, isPilotageError, parisDay, pilotageErrorKey, rate } from "@/lib/pilotage";

describe("rate", () => {
  it("rounds to a whole percent, and says nothing when there is nothing to divide", () => {
    expect(rate(1, 3)).toBe(33);
    expect(rate(2, 3)).toBe(67);
    expect(rate(0, 0)).toBeNull();
  });
});

describe("parisDay and healthPeriod", () => {
  const now = new Date("2026-10-19T23:30:00Z"); // already the 20th in Paris

  it("counts days in Paris", () => {
    expect(parisDay(now)).toBe("2026-10-20");
    expect(parisDay(now, -29)).toBe("2026-09-21");
  });

  it("defaults to the last 30 days and refuses a reversed or too long period", () => {
    expect(healthPeriod(undefined, undefined, now)).toEqual({
      from: "2026-09-21",
      to: "2026-10-20",
    });
    expect(healthPeriod("2026-10-01", "2026-10-10", now)).toEqual({
      from: "2026-10-01",
      to: "2026-10-10",
    });
    expect(healthPeriod("2026-10-10", "2026-10-01", now)).toEqual({
      from: "2026-09-21",
      to: "2026-10-20",
    });
    expect(healthPeriod("2024-01-01", "2026-10-01", now)).toEqual({
      from: "2026-09-21",
      to: "2026-10-20",
    });
    expect(healthPeriod("not a day", undefined, now).from).toBe("2026-09-21");
  });
});

describe("pilotage errors", () => {
  it("keeps the keys raised by Postgres, anything else is generic", () => {
    expect(pilotageErrorKey("core_question")).toBe("core_question");
    expect(pilotageErrorKey("syntax error")).toBe("generic");
    expect(isPilotageError("ambiguous_place")).toBe(true);
    expect(isPilotageError("<b>")).toBe(false);
  });
});
