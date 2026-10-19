"use client";

import { CalendarClock, Compass, IdCard, Mail, Send, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { tabStateAction, type TabState } from "@/app/[locale]/(app)/tab-actions";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

const ICONS = {
  promenade: Sun,
  discover: Compass,
  requests: Send,
  visits: CalendarClock,
  myPermit: IdCard,
  mailbox: Mail,
  myFiche: IdCard,
};

export type TabLink = {
  href: string;
  key: keyof typeof ICONS;
  news: readonly string[];
  /** The tab shows the number of unread Parloir messages (« Visites »). */
  counts: boolean;
};

const POLL_MS = 60_000;

function isCurrent(pathname: string, href: string) {
  return (
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === "/promenade" && pathname.startsWith("/fiche/"))
  );
}

/**
 * The tabs and their badges: a dot for news, the number of unread messages on « Visites ». Read
 * again every 60 s, on return to the browser tab and on each navigation (SPEC §13).
 */
export function TabBarLinks({ tabs, initial }: { tabs: readonly TabLink[]; initial: TabState }) {
  const t = useTranslations("Relations.tabs");
  const pathname = usePathname();
  const [state, setState] = useState(initial);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      tabStateAction()
        .then((next) => {
          if (alive) setState(next);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [pathname]);

  const types = new Set<string>(state.types);
  return (
    <ul className="mx-auto flex max-w-3xl">
      {tabs.map(({ href, key, news, counts }) => {
        const Icon = ICONS[key];
        const current = isCurrent(pathname, href);
        const unread = counts ? state.unread : 0;
        const dot = !current && unread === 0 && news.some((type) => types.has(type));
        return (
          <li key={href} className="flex-1">
            <Link
              href={href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold",
                current ? "text-accent" : "text-grey hover:text-cream",
              )}
            >
              <span className="relative">
                <Icon aria-hidden="true" className="size-5" />
                {unread > 0 ? (
                  <span
                    aria-hidden="true"
                    className="bg-accent text-ink absolute -top-1.5 -right-2.5 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-bold ring-2 ring-[var(--color-ink)]"
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                ) : dot ? (
                  <span
                    aria-hidden="true"
                    className="bg-accent absolute -top-0.5 -right-1 size-2.5 rounded-full ring-2 ring-[var(--color-ink)]"
                  />
                ) : null}
              </span>
              {t(key)}
              {unread > 0 ? (
                <span className="sr-only">{t("unread", { count: unread })}</span>
              ) : dot ? (
                <span className="sr-only">{t("news")}</span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
