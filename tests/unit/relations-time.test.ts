import { describe, expect, it } from "vitest";
import { nextPromenadeAt, untilParts } from "@/lib/relations/time";

describe("next Promenade (21:00, Europe/Paris)", () => {
  it("same evening before 21:00 (summer time, UTC+2)", () => {
    expect(nextPromenadeAt(new Date("2026-07-10T12:00:00Z")).toISOString()).toBe(
      "2026-07-10T19:00:00.000Z",
    );
  });
  it("next evening once 21:00 has passed (winter time, UTC+1)", () => {
    expect(nextPromenadeAt(new Date("2026-01-10T20:30:00Z")).toISOString()).toBe(
      "2026-01-11T20:00:00.000Z",
    );
  });
  it("exactly at 21:00: the next one is tomorrow", () => {
    expect(nextPromenadeAt(new Date("2026-01-10T20:00:00Z")).toISOString()).toBe(
      "2026-01-11T20:00:00.000Z",
    );
  });
  it("across the switch to summer time (29 March 2026)", () => {
    expect(nextPromenadeAt(new Date("2026-03-28T21:00:00Z")).toISOString()).toBe(
      "2026-03-29T19:00:00.000Z",
    );
  });
  it("hours and minutes left", () => {
    expect(untilParts(new Date("2026-01-10T20:48:00Z"), new Date("2026-01-11T20:00:00Z"))).toEqual({
      hours: 23,
      minutes: 12,
    });
  });
});
