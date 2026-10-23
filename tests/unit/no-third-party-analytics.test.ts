import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Project rule (SPEC §10: no third-party tracker nor external analytics). The Core Web Vitals are
// measured by the site itself (lib/vitals, /admin/performance), without any identifier.
const FORBIDDEN = ["@vercel/analytics", "@vercel/speed-insights"];

describe("no third-party measurement tool", () => {
  it("package.json declares neither @vercel/analytics nor @vercel/speed-insights", () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    const declared = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ].flatMap((section) => Object.keys(pkg[section] ?? {}));
    expect(declared.filter((name) => FORBIDDEN.includes(name))).toEqual([]);
  });
});
