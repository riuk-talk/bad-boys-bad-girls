import { describe, expect, it } from "vitest";
import { parseDashboard } from "@/lib/admin/dashboard";
import { ADMIN_NAV, activeHref, parseCounts, searchQuery } from "@/lib/admin/nav";

describe("admin menu (10c)", () => {
  it("has the groups of the request, the dashboard first, every page once", () => {
    expect(ADMIN_NAV.map((group) => group.key)).toEqual([
      null,
      "accounts",
      "moderation",
      "reports",
      "content",
      "tools",
    ]);
    const hrefs = ADMIN_NAV.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs[0]).toBe("/admin");
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/admin/membres",
        "/admin/historique",
        "/admin/greffe",
        "/admin/textes",
        "/admin/mots-cles",
        "/admin/signalements",
        "/admin/questions",
        "/admin/signes",
        "/admin/quartiers",
        "/admin/vue",
        "/admin/performance",
      ]),
    );
    const view = ADMIN_NAV.flatMap((group) => group.items).find(
      (item) => item.href === "/admin/vue",
    );
    expect(view?.highlight).toBe(true);
  });

  it("marks the entry of the page, and of the pages below it", () => {
    expect(activeHref("/admin")).toBe("/admin");
    expect(activeHref("/admin/")).toBe("/admin");
    expect(activeHref("/admin/greffe")).toBe("/admin/greffe");
    expect(activeHref("/admin/greffe/lot")).toBe("/admin/greffe");
    expect(activeHref("/admin/membres/2b0c…")).toBe("/admin/membres");
    expect(activeHref("/admin/vue/fiche/x")).toBe("/admin/vue");
    // The dashboard is not active on the pages below /admin.
    expect(activeHref("/admin/quartiers/3")).toBe("/admin/quartiers");
    expect(activeHref("/admin/unknown")).toBe(null);
    expect(activeHref("/admin-other")).toBe(null);
  });

  it("keeps counters only as whole numbers from the database, never a made-up 0", () => {
    expect(parseCounts({ photos_pending: 3, reports_open: 0, flags_open: 12 })).toEqual({
      photos_pending: 3,
      reports_open: 0,
      flags_open: 12,
    });
    expect(parseCounts(null)).toBe(null);
    expect(parseCounts({ photos_pending: 3, reports_open: 1 })).toBe(null);
    expect(parseCounts({ photos_pending: -1, reports_open: 0, flags_open: 0 })).toBe(null);
    expect(parseCounts({ photos_pending: "3", reports_open: 0, flags_open: 0 })).toBe(null);
  });

  it("searches from 2 to 254 characters", () => {
    expect(searchQuery(" a ")).toBe(null);
    expect(searchQuery(" lu ")).toBe("lu");
    expect(searchQuery("x".repeat(255))).toBe(null);
    expect(searchQuery(42)).toBe(null);
  });
});

describe("dashboard figures (10c)", () => {
  it("shows a missing or malformed figure as missing, not as 0", () => {
    const d = parseDashboard({
      bads_registered: 12,
      bads_complete: 8,
      bads_visible: 0,
      emails_sent_today: null,
      push_queued: "4",
      todo: [],
    });
    expect(d.bads_registered).toBe(12);
    expect(d.bads_visible).toBe(0);
    expect(d.emails_sent_today).toBe(null);
    expect(d.push_queued).toBe(null);
    expect(d.visitors_registered).toBe(null);
    expect(parseDashboard(null).photos_pending).toBe(null);
  });

  it("keeps at most 10 well-formed items to deal with", () => {
    const item = { kind: "photo", created_at: "2026-11-07T08:00:00Z", pseudo: "Lune", detail: "0" };
    const d = parseDashboard({
      todo: [
        ...Array.from({ length: 12 }, () => item),
        { kind: "secret", created_at: "2026-11-07T08:00:00Z", pseudo: null, detail: null },
        { kind: "flag", created_at: "not a date", pseudo: null, detail: "bio" },
      ],
    });
    expect(d.todo).toHaveLength(10);
    expect(d.todo.every((entry) => entry.kind === "photo")).toBe(true);
  });
});
