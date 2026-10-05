import { describe, expect, it } from "vitest";
import { isSignupsOpen } from "@/lib/signups-flag";

describe("SIGNUPS_OPEN: closed by default", () => {
  it('opens only for the exact value "true"', () => {
    expect(isSignupsOpen("true")).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "True", " true", "true ", "1", "yes", "on", "open"])(
    "stays closed for %j",
    (value) => {
      expect(isSignupsOpen(value)).toBe(false);
    },
  );
});
