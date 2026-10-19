import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidVapidSubject } from "@/lib/push/dispatch";

// The route must stop before touching the database when the VAPID contact is unusable.
const createAdminClient = vi.fn(() => {
  throw new Error("the database must not be reached");
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

const SECRET = "s".repeat(48);

describe("isValidVapidSubject", () => {
  it("accepts an https: URL or a mailto: address", () => {
    expect(isValidVapidSubject("https://bad-boys-bad-girls.vercel.app")).toBe(true);
    expect(isValidVapidSubject("https://example.com/contact")).toBe(true);
    expect(isValidVapidSubject("mailto:bonjour@example.com")).toBe(true);
  });
  it("refuses anything else", () => {
    for (const subject of [
      "http://bad-boys-bad-girls.vercel.app",
      "bad-boys-bad-girls.vercel.app",
      "bonjour@example.com",
      "mailto:",
      "mailto:pas-une-adresse",
      "ftp://example.com",
      "",
    ]) {
      expect(isValidVapidSubject(subject), subject).toBe(false);
    }
  });
});

describe("POST /api/cron/push", () => {
  beforeEach(() => {
    vi.stubEnv("PUSH_CRON_SECRET", SECRET);
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "B".repeat(87));
    vi.stubEnv("VAPID_PRIVATE_KEY", "p".repeat(43));
    createAdminClient.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  async function call(auth = `Bearer ${SECRET}`) {
    const { POST } = await import("@/app/api/cron/push/route");
    return POST(
      new NextRequest("http://localhost/api/cron/push", {
        method: "POST",
        headers: { authorization: auth },
      }),
    );
  }

  it("503 push_misconfigured for an http: subject, without reaching the database", async () => {
    vi.stubEnv("VAPID_SUBJECT", "http://bad-boys-bad-girls.vercel.app");
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "push_misconfigured" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("503 push_not_configured when the subject is missing", async () => {
    vi.stubEnv("VAPID_SUBJECT", "");
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "push_not_configured" });
  });

  it("401 before anything else without the secret", async () => {
    vi.stubEnv("VAPID_SUBJECT", "http://bad-boys-bad-girls.vercel.app");
    const response = await call("Bearer wrong");
    expect(response.status).toBe(401);
  });
});
