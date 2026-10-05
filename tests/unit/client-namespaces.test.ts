import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

describe("client i18n namespaces", () => {
  it("sends every namespace a client component uses (otherwise raw keys are shown)", () => {
    const source = readFileSync(join(ROOT, "components/i18n/client-intl.tsx"), "utf8");
    const sent = new Set([...source.matchAll(/^\s+"([A-Za-z]+)",$/gm)].map((m) => m[1]));
    const used = new Set<string>();
    for (const file of [...files(join(ROOT, "components")), ...files(join(ROOT, "app"))]) {
      const code = readFileSync(file, "utf8");
      if (!code.startsWith('"use client"')) continue;
      for (const match of code.matchAll(/useTranslations\("([A-Za-z]+)/g)) used.add(match[1]!);
    }
    expect([...used].filter((ns) => !sent.has(ns))).toEqual([]);
  });
});
