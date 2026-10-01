import { describe, expect, it } from "vitest";
import { indexableMetadata, isIndexable, stripLocale } from "@/lib/seo";

describe("seo", () => {
  it("strips the en prefix only", () => {
    expect(stripLocale("/en")).toBe("/");
    expect(stripLocale("/en/charte")).toBe("/charte");
    expect(stripLocale("/english")).toBe("/english");
  });

  it.each([
    ["/", true],
    ["/en", true],
    ["/charte", true],
    ["/en/cgu", true],
    ["/mentions-legales/", true],
    ["/conseils-securite", false],
    ["/connexion", false],
    ["/inscription", false],
    ["/design", false],
    ["/en/connexion", false],
  ])("isIndexable(%s) = %s", (path, expected) => {
    expect(isIndexable(path)).toBe(expected);
  });

  it("builds canonical and alternates", () => {
    expect(indexableMetadata("en", "/charte").alternates.canonical).toBe("/en/charte");
    expect(indexableMetadata("fr", "/").alternates.languages).toEqual({
      fr: "/",
      en: "/en",
      "x-default": "/",
    });
  });
});

describe("localizedPath", async () => {
  const { localizedPath } = await import("@/lib/i18n-path");
  it("keeps French unprefixed and prefixes English", () => {
    expect(localizedPath("/", "fr")).toBe("/");
    expect(localizedPath("/charte", "fr")).toBe("/charte");
    expect(localizedPath("/", "en")).toBe("/en");
    expect(localizedPath("/charte", "en")).toBe("/en/charte");
  });
});
