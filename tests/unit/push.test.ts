import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyPushError,
  isAuthorizedCron,
  messageOutcome,
  pushPayload,
} from "@/lib/push/dispatch";

const SECRET = "s".repeat(48);

describe("isAuthorizedCron", () => {
  it("accepts only the exact Bearer secret", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
  });
  it("refuses everything when the secret is missing or too short", () => {
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer short", "short")).toBe(false);
  });
});

describe("pushPayload", () => {
  it("carries only the type and an internal path, prefixed for English", () => {
    expect(JSON.parse(pushPayload("request_received", "/courrier", "fr"))).toEqual({
      t: "request_received",
      u: "/courrier",
    });
    expect(JSON.parse(pushPayload("request_received", "/courrier", "en")).u).toBe("/en/courrier");
  });
  it("never forwards anything that is not a plain internal path", () => {
    for (const path of ["//evil.test", "https://evil.test", "/a?x=1", "/Nox", 42, null]) {
      expect(JSON.parse(pushPayload("request_received", path, "fr")).u).toBe("/");
    }
    expect(JSON.parse(pushPayload("x", null, "en")).u).toBe("/en");
  });
});

describe("push outcomes", () => {
  it("404 and 410 mean gone, anything else a passing failure", () => {
    expect(classifyPushError(410)).toBe("gone");
    expect(classifyPushError(404)).toBe("gone");
    expect(classifyPushError(429)).toBe("failed");
    expect(classifyPushError(undefined)).toBe("failed");
  });
  it("a message is sent once one browser got it, retried on a passing failure", () => {
    expect(messageOutcome(["failed", "delivered"])).toBe("sent");
    expect(messageOutcome(["gone", "failed"])).toBe("retry");
    expect(messageOutcome(["gone"])).toBe("skipped");
    expect(messageOutcome([])).toBe("skipped");
  });
});

describe("service worker texts", () => {
  const source = readFileSync("public/sw.js", "utf8");
  const json = source.split("/* TEXTS */")[1]!.split("/* /TEXTS */")[0]!;
  const texts = JSON.parse(json) as Record<"fr" | "en", Record<string, [string, string]>>;
  // Every type push_path() (migrations phase5a, phase5b, phase5c, phase6b) can queue, plus the fallback.
  const types = [
    "request_received",
    "request_accepted",
    "request_dismissed",
    "slot_chosen",
    "visit_reminder_1h",
    "visit_starting",
    "visit_no_show",
    "visit_released",
    "visit_closed",
    "message_received",
    "date_proposed",
    "date_accepted",
    "date_countered",
    "date_cancelled",
    "promenade_open",
    "permit_granted",
    "moderation_decision",
    "default",
  ];

  it("has a title and a body for every pushed type, in French and English", () => {
    for (const locale of ["fr", "en"] as const) {
      expect(Object.keys(texts[locale]).sort()).toEqual([...types].sort());
      for (const [title, body] of Object.values(texts[locale])) {
        expect(title.length).toBeGreaterThan(0);
        expect(body.length).toBeGreaterThan(0);
      }
    }
  });

  it("stays neutral and uses the product vocabulary", () => {
    const all = Object.values(texts)
      .flatMap((byType) => Object.values(byType).flat())
      .join("\n")
      .toLowerCase();
    expect(all).not.toMatch(/\b(match|matchs|matches|swipe|like|likes|liked|judge)\b/);
    expect(all).not.toMatch(/\{|pseudo|photo/);
  });

  it("registers no fetch handler and no cache", () => {
    expect(source).not.toMatch(/addEventListener\(\s*["']fetch/);
    expect(source).not.toMatch(/caches\./);
  });
});
