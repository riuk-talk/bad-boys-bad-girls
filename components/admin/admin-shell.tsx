"use client";

import { Eye, Menu, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { adminCountsAction } from "@/app/[locale]/(app)/admin/shell-actions";
import { Link, usePathname } from "@/i18n/navigation";
import { ADMIN_NAV, activeHref, type AdminCounts } from "@/lib/admin/nav";
import { cn } from "@/lib/cn";
import { MemberSearch } from "./member-search";

const POLL_MS = 30_000;

/**
 * The live counters: read again every 30 s, and on return to the browser tab, only while the tab
 * is visible (10c).
 */
function useCounts(initial: AdminCounts | null) {
  const [counts, setCounts] = useState(initial);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      adminCountsAction()
        .then((next) => {
          if (alive && next) setCounts(next);
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return counts;
}

function NavList({
  counts,
  onNavigate,
  idPrefix,
}: {
  counts: AdminCounts | null;
  onNavigate?: () => void;
  idPrefix: string;
}) {
  const t = useTranslations("AdminShell");
  const pathname = usePathname();
  const active = activeHref(pathname);
  return (
    <div className="flex flex-col gap-5">
      {ADMIN_NAV.map((group) => {
        const headingId = group.key ? `${idPrefix}-${group.key}` : undefined;
        return (
          <div key={group.key ?? "home"} className="flex flex-col gap-1">
            {group.key ? (
              <p
                id={headingId}
                className="text-grey px-3 text-xs font-bold tracking-[0.12em] uppercase"
              >
                {t(`groups.${group.key}`)}
              </p>
            ) : null}
            <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const current = active === item.href;
                const count = item.counter && counts ? counts[item.counter] : null;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      prefetch={false}
                      onClick={onNavigate}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold",
                        current
                          ? "bg-cream text-ink"
                          : item.highlight
                            ? "border-accent text-cream hover:bg-ink-2 border"
                            : "text-cream hover:bg-ink-2",
                      )}
                    >
                      {item.highlight ? (
                        <Eye aria-hidden="true" className="size-4 shrink-0" />
                      ) : null}
                      <span className="flex-1">{t(`items.${item.key}`)}</span>
                      {count !== null && count > 0 ? (
                        <span
                          className={cn(
                            "min-w-6 rounded-full px-1.5 text-center text-xs leading-6 font-bold",
                            current ? "bg-ink text-cream" : "bg-accent text-ink",
                          )}
                        >
                          {count > 99 ? "99+" : count}
                          <span className="sr-only"> {t("waiting", { count })}</span>
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The shell of /admin (10c): a fixed side menu from lg up; below, a « Menu admin » button that
 * opens the same menu in a drawer (native <dialog>: focus trap, Escape, inert page), closed on a
 * choice, focus given back to the button. The member search sits in the bar, Ctrl/⌘K opens it.
 */
/**
 * Tab and Shift+Tab go round inside the drawer: a modal <dialog> alone lets the focus leave for the
 * browser's own controls after its last element (Chromium).
 */
function trapFocus(event: ReactKeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const focusable = [
    ...event.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
  ];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function AdminShell({
  initialCounts,
  children,
}: {
  initialCounts: AdminCounts | null;
  children: ReactNode;
}) {
  const t = useTranslations("AdminShell");
  const counts = useCounts(initialCounts);
  const drawer = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [searching, setSearching] = useState(false);
  const titleId = useId();

  const closeDrawer = useCallback(() => {
    if (drawer.current?.open) drawer.current.close();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        closeDrawer();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDrawer]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col lg:flex-row lg:items-start">
      <div className="border-line bg-ink sticky top-0 z-30 flex items-center gap-2 border-b px-4 py-2 sm:px-6 lg:hidden">
        <button
          ref={menuButton}
          type="button"
          onClick={() => drawer.current?.showModal()}
          aria-haspopup="dialog"
          className="border-line text-cream inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold"
        >
          <Menu aria-hidden="true" className="size-5" />
          {t("openMenu")}
        </button>
        <button
          type="button"
          onClick={() => setSearching(true)}
          className="border-line text-cream ml-auto inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold"
        >
          <Search aria-hidden="true" className="size-5" />
          {t("search")}
        </button>
      </div>

      <nav
        aria-label={t("label")}
        className="border-line sticky top-0 hidden max-h-dvh w-64 shrink-0 overflow-y-auto border-r px-3 py-6 lg:block"
      >
        <button
          type="button"
          onClick={() => setSearching(true)}
          className="border-line text-grey hover:text-cream mb-5 flex min-h-11 w-full items-center gap-2 rounded-md border px-3 text-sm"
        >
          <Search aria-hidden="true" className="size-4" />
          <span className="flex-1 text-left">{t("search")}</span>
          <kbd className="text-xs">{t("shortcut")}</kbd>
        </button>
        <NavList counts={counts} idPrefix="side" />
      </nav>

      <dialog
        ref={drawer}
        aria-labelledby={titleId}
        onClose={() => menuButton.current?.focus()}
        onKeyDown={trapFocus}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDrawer();
        }}
        className="bg-ink text-cream border-line backdrop:bg-ink/80 m-0 h-dvh max-h-dvh w-[min(20rem,100%-3rem)] border-r p-0 lg:hidden"
      >
        <nav aria-label={t("label")} className="flex h-full flex-col">
          <div className="border-line flex items-center justify-between border-b px-4 py-3">
            <h2 id={titleId} className="font-display text-xl tracking-wide uppercase">
              {t("menuTitle")}
            </h2>
            <button
              type="button"
              onClick={closeDrawer}
              aria-label={t("closeMenu")}
              className="text-grey hover:text-cream inline-flex size-11 items-center justify-center rounded-full"
            >
              <X aria-hidden="true" className="size-6" />
            </button>
          </div>
          <div className="overflow-y-auto px-3 py-4">
            <NavList counts={counts} onNavigate={closeDrawer} idPrefix="drawer" />
          </div>
        </nav>
      </dialog>

      <MemberSearch open={searching} onClose={() => setSearching(false)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
