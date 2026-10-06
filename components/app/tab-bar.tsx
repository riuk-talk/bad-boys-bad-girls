import { Compass, IdCard, Mail, Send, Sun } from "lucide-react";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { cn } from "@/lib/cn";
import type { Role } from "@/lib/onboarding/config";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

type NotificationType = Database["public"]["Enums"]["notification_type"];

/**
 * Bottom navigation (maquettes Promenade, Courrier). Phase 4: the « Visites » and « Parloir »
 * tabs stay hidden until the visits exist (Phase 5).
 */
type Tab = { href: string; key: string; Icon: typeof Sun; news?: readonly NotificationType[] };

const TABS: Record<Role, readonly Tab[]> = {
  visitor: [
    { href: "/promenade", key: "promenade", Icon: Sun, news: ["promenade_open"] },
    { href: "/decouverte", key: "discover", Icon: Compass },
    {
      href: "/demandes",
      key: "requests",
      Icon: Send,
      news: ["request_accepted", "request_dismissed"],
    },
    { href: "/ma-fiche", key: "myPermit", Icon: IdCard },
  ],
  bad: [
    { href: "/courrier", key: "mailbox", Icon: Mail, news: ["request_received"] },
    { href: "/ma-fiche", key: "myFiche", Icon: IdCard },
  ],
};

/** The in-app notifications of each tab (Phase 4: no Web Push yet), read when the tab is opened. */
export const TAB_NEWS = Object.fromEntries(
  Object.values(TABS).flatMap((tabs) =>
    tabs.filter((tab) => tab.news).map((tab) => [tab.href, tab.news ?? []]),
  ),
) as Record<string, readonly NotificationType[]>;

function isCurrent(pathname: string, href: string) {
  const path = pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  return (
    path === href ||
    path.startsWith(`${href}/`) ||
    (href === "/promenade" && path.startsWith("/fiche/"))
  );
}

export async function TabBar({ role }: { role: Role }) {
  const t = await getTranslations("Relations.tabs");
  const pathname = (await headers()).get("x-pathname") ?? "";
  const supabase = await createClient();
  const { data: unread } = await supabase
    .from("notifications")
    .select("type")
    .is("read_at", null)
    .limit(200);
  const unreadTypes = new Set((unread ?? []).map((row) => row.type));
  return (
    <nav
      aria-label={t("label")}
      className="border-line/70 bg-ink sticky bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-3xl">
        {TABS[role].map(({ href, key, Icon }) => {
          const current = isCurrent(pathname, href);
          const news = !current && TAB_NEWS[href]?.some((type) => unreadTypes.has(type));
          return (
            <li key={href} className="flex-1">
              <LocalizedLink
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold",
                  current ? "text-accent" : "text-grey hover:text-cream",
                )}
              >
                <span className="relative">
                  <Icon aria-hidden="true" className="size-5" />
                  {news ? (
                    <span
                      aria-hidden="true"
                      className="bg-accent absolute -top-0.5 -right-1 size-2.5 rounded-full ring-2 ring-[var(--color-ink)]"
                    />
                  ) : null}
                </span>
                {t(key)}
                {news ? <span className="sr-only">{t("news")}</span> : null}
              </LocalizedLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
