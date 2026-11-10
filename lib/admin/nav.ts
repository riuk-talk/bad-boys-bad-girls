/**
 * The menu of /admin (10c, after the Admin panel of TeaseYou): groups with a heading, the dashboard
 * first. The live counters show what waits in the Greffe, the reports and the flagged texts.
 */
export type AdminCounterKey = "photos_pending" | "reports_open" | "flags_open";

export type AdminNavItem = {
  key: string;
  href: string;
  /** Active only on this exact path (the dashboard), not on the pages below it. */
  exact?: boolean;
  counter?: AdminCounterKey;
  /** Shown apart (« Voir comme un Visiteur »). */
  highlight?: boolean;
};

export type AdminNavGroup = { key: string | null; items: AdminNavItem[] };

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  { key: null, items: [{ key: "dashboard", href: "/admin", exact: true }] },
  {
    key: "accounts",
    items: [
      { key: "members", href: "/admin/membres" },
      { key: "history", href: "/admin/historique" },
      { key: "corrections", href: "/admin/corrections" },
    ],
  },
  {
    key: "moderation",
    items: [
      { key: "greffe", href: "/admin/greffe", counter: "photos_pending" },
      { key: "flags", href: "/admin/textes", counter: "flags_open" },
      { key: "keywords", href: "/admin/mots-cles" },
    ],
  },
  {
    key: "reports",
    items: [{ key: "reports", href: "/admin/signalements", counter: "reports_open" }],
  },
  {
    key: "content",
    items: [
      { key: "questions", href: "/admin/questions" },
      { key: "tribes", href: "/admin/signes" },
      { key: "zones", href: "/admin/quartiers" },
    ],
  },
  {
    key: "tools",
    items: [
      { key: "view", href: "/admin/vue", highlight: true },
      { key: "performance", href: "/admin/performance" },
    ],
  },
];

/** The entry of the current page: the longest href that the path is, or is below. */
export function activeHref(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  let best: AdminNavItem | null = null;
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      const match = item.exact
        ? path === item.href
        : path === item.href || path.startsWith(`${item.href}/`);
      if (match && (!best || item.href.length > best.href.length)) best = item;
    }
  }
  return best?.href ?? null;
}

export type AdminCounts = Record<AdminCounterKey, number>;

/** The counters as the database gives them; anything else is no counter (never a made-up 0). */
export function parseCounts(value: unknown): AdminCounts | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const keys: AdminCounterKey[] = ["photos_pending", "reports_open", "flags_open"];
  if (!keys.every((key) => Number.isInteger(row[key]) && (row[key] as number) >= 0)) return null;
  return {
    photos_pending: row.photos_pending as number,
    reports_open: row.reports_open as number,
    flags_open: row.flags_open as number,
  };
}

/** What a search may be: 2 to 254 characters once trimmed (the database checks it again). */
export function searchQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const q = value.trim();
  return q.length >= 2 && q.length <= 254 ? q : null;
}
