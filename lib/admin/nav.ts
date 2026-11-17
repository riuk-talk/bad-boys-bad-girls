/**
 * The menu of /admin (10c, after the Admin panel of TeaseYou): groups with a heading, the dashboard
 * first. The live counters show what waits in the Greffe, the reports and the flagged texts.
 */
import type { AdminPermission } from "./permissions";

export type AdminCounterKey = "photos_pending" | "reports_open" | "flags_open";

export type AdminNavItem = {
  key: string;
  href: string;
  /** Active only on this exact path (the dashboard), not on the pages below it. */
  exact?: boolean;
  counter?: AdminCounterKey;
  /** Shown apart (« Voir comme un Visiteur »). */
  highlight?: boolean;
  /** The permission its page asks for (10f): the entry is shown only with it. */
  permission: AdminPermission;
};

export type AdminNavGroup = { key: string | null; items: AdminNavItem[] };

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    key: null,
    items: [{ key: "dashboard", href: "/admin", exact: true, permission: "dashboard.view" }],
  },
  {
    key: "accounts",
    items: [
      { key: "members", href: "/admin/membres", permission: "members.view" },
      { key: "history", href: "/admin/historique", permission: "history.view" },
      { key: "corrections", href: "/admin/corrections", permission: "birthdate.decide" },
      { key: "team", href: "/admin/equipe", permission: "team.manage" },
    ],
  },
  {
    key: "moderation",
    items: [
      {
        key: "greffe",
        href: "/admin/greffe",
        counter: "photos_pending",
        permission: "greffe.decide",
      },
      { key: "flags", href: "/admin/textes", counter: "flags_open", permission: "flags.decide" },
      { key: "keywords", href: "/admin/mots-cles", permission: "keywords.edit" },
    ],
  },
  {
    key: "reports",
    items: [
      {
        key: "reports",
        href: "/admin/signalements",
        counter: "reports_open",
        permission: "reports.decide",
      },
    ],
  },
  {
    key: "content",
    items: [
      { key: "questions", href: "/admin/questions", permission: "questions.edit" },
      { key: "tribes", href: "/admin/signes", permission: "signs.edit" },
      { key: "zones", href: "/admin/quartiers", permission: "zones.edit" },
    ],
  },
  {
    key: "tools",
    items: [
      { key: "view", href: "/admin/vue", highlight: true, permission: "vue_visiteur.view" },
      { key: "performance", href: "/admin/performance", permission: "performance.view" },
    ],
  },
];

/** The menu of an admin (10f): only the entries its permissions open, empty groups left out. */
export function navFor(permissions: readonly AdminPermission[]): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => permissions.includes(item.permission)),
  })).filter((group) => group.items.length > 0);
}

/** Where an admin lands: the dashboard, or else the first page its permissions open. */
export function homeFor(permissions: readonly AdminPermission[]): string | null {
  return navFor(permissions)[0]?.items[0]?.href ?? null;
}

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
