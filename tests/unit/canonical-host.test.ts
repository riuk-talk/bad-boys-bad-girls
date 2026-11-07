import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalRedirect } from "@/lib/canonical-host";

// The locale routing of next-intl is not what is tested here (and its ESM build does not load
// under Vitest): it lets the request through.
vi.mock("next-intl/middleware", () => ({ default: () => () => NextResponse.next() }));

const target = "https://bad-boys8bad-girls.fr";

describe("canonicalRedirect", () => {
  const at = (href: string) => new URL(href);

  it("sends the other hosts of production to bad-boys8bad-girls.fr, path and query kept", () => {
    expect(
      canonicalRedirect(
        at("https://bad-boys-bad-girls.vercel.app/fr/connexion?next=%2Fcourrier&x=1"),
        "bad-boys-bad-girls.vercel.app",
        "production",
      ),
    ).toBe(`${target}/fr/connexion?next=%2Fcourrier&x=1`);
    expect(
      canonicalRedirect(
        at("https://bad-boys-bad-girls-git-main-riuk.vercel.app/inscription"),
        "bad-boys-bad-girls-git-main-riuk.vercel.app",
        "production",
      ),
    ).toBe(`${target}/inscription`);
    expect(canonicalRedirect(at("https://x.vercel.app/"), "x.vercel.app", "production")).toBe(
      `${target}/`,
    );
  });

  it("serves the canonical host and www as they are (case, port and final dot ignored)", () => {
    for (const host of [
      "bad-boys8bad-girls.fr",
      "www.bad-boys8bad-girls.fr",
      "Bad-Boys8Bad-Girls.FR",
      "bad-boys8bad-girls.fr:443",
      "bad-boys8bad-girls.fr.",
    ]) {
      expect(canonicalRedirect(at(`https://${host}/connexion`), host, "production"), host).toBe(
        null,
      );
    }
  });

  it("never touches previews nor local development", () => {
    for (const env of ["preview", "development", undefined]) {
      expect(
        canonicalRedirect(
          at("https://bad-boys-bad-girls-git-phase-10-riuk.vercel.app/connexion"),
          "bad-boys-bad-girls-git-phase-10-riuk.vercel.app",
          env,
        ),
        String(env),
      ).toBe(null);
      expect(canonicalRedirect(at("http://localhost:3000/"), "localhost:3000", env)).toBe(null);
    }
  });

  it("a look-alike of the canonical host is redirected too", () => {
    expect(
      canonicalRedirect(
        at("https://bad-boys8bad-girls.fr.evil.example/connexion"),
        "bad-boys8bad-girls.fr.evil.example",
        "production",
      ),
    ).toBe(`${target}/connexion`);
  });
});

describe("proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function run(href: string, headers: Record<string, string> = {}) {
    const { default: proxy } = await import("@/proxy");
    return proxy(new NextRequest(href, { headers }));
  }

  it("answers 308 to the canonical host in production, before anything else", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const response = await run("https://bad-boys-bad-girls.vercel.app/fr/connexion?a=1", {
      host: "bad-boys-bad-girls.vercel.app",
    });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`${target}/fr/connexion?a=1`);
  });

  it("reads the forwarded host first (Vercel's edge)", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const response = await run("https://internal.example/inscription", {
      host: "internal.example",
      "x-forwarded-host": "bad-boys8bad-girls.fr",
    });
    expect(response.status).not.toBe(308);
  });

  it("serves the canonical host normally, and previews whatever their host", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const canonical = await run(`${target}/fr/connexion`, { host: "bad-boys8bad-girls.fr" });
    expect(canonical.status).not.toBe(308);
    expect(canonical.headers.get("content-security-policy")).toContain("challenges.cloudflare.com");

    vi.stubEnv("VERCEL_ENV", "preview");
    const preview = await run("https://bad-boys-bad-girls-git-x-riuk.vercel.app/fr/connexion", {
      host: "bad-boys-bad-girls-git-x-riuk.vercel.app",
    });
    expect(preview.status).not.toBe(308);
  });
});
