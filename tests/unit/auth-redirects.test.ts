import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirects";

describe("safeNextPath", () => {
  it.each([
    ["/ma-fiche", "/ma-fiche"],
    ["/en/onboarding", "/en/onboarding"],
    [null, "/onboarding"],
    ["https://evil.example", "/onboarding"],
    ["//evil.example", "/onboarding"],
    ["/\\evil.example", "/onboarding"],
    ["ma-fiche", "/onboarding"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
