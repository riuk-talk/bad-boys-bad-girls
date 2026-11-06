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

  // WCAG 2.4.11: what takes the focus under the sticky bar is brought above it, by exactly the
  // part it hides. Once at once, and once more at the next frame: WebKit runs its own focus scroll
  // after the event and may put the element back under the bar (CI n° 63 and 65, /mon-casier).
  // For a textarea, WebKit reveals the caret later still, ignoring scroll-padding (CI n° 107): any
  // scroll in the moment after the focus is corrected too, before the next frame is painted.
  useEffect(() => {
    let focused: { target: HTMLElement; at: number } | null = null;
    const lift = (target: HTMLElement) => {
      const bar = document.querySelector("[data-tab-bar]");
      if (!bar || bar.contains(target) || !target.isConnected) return;
      const hidden = target.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
      if (hidden > 0) window.scrollBy(0, hidden + 8);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      focused = { target, at: performance.now() };
      lift(target);
      requestAnimationFrame(() => lift(target));
    };
    const onScroll = () => {
      if (!focused || performance.now() - focused.at > 600) return;
      if (document.activeElement === focused.target) lift(focused.target);
    };
    document.addEventListener("focusin", onFocus);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

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
