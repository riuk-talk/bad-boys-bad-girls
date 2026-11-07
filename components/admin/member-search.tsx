"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { adminSearchAction, type MemberHit } from "@/app/[locale]/(app)/admin/shell-actions";
import { Modal } from "@/components/ui/modal";
import { Link } from "@/i18n/navigation";
import { searchQuery } from "@/lib/admin/nav";

/**
 * « Rechercher un membre » (10c): pseudo or N° d'écrou (part of it), or the exact e-mail. At most
 * 20 results; one opens the page of the account in Membres.
 */
export function MemberSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("AdminShell");
  const inputId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemberHit[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  useEffect(() => {
    const q = searchQuery(query);
    if (!q) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      adminSearchAction(q)
        .then((result) => {
          if (!alive) return;
          setFailed(result === null);
          setHits(result ?? []);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const searched = searchQuery(query) !== null;
  const close = () => {
    setQuery("");
    setHits(null);
    setFailed(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={t("search")}>
      <form role="search" onSubmit={(event) => event.preventDefault()} className="space-y-3">
        <label htmlFor={inputId} className="block text-sm font-semibold">
          {t("searchLabel")}
        </label>
        <input
          ref={input}
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={254}
          autoComplete="off"
          aria-describedby={hintId}
          className="border-line bg-ink text-cream focus-visible:border-accent min-h-11 w-full rounded-lg border px-3.5"
        />
        <p id={hintId} className="text-grey text-sm">
          {t("searchHint")}
        </p>
      </form>
      <div role="status" aria-live="polite" className="mt-3 min-h-6">
        {failed ? <p className="text-red-bright text-sm">{t("searchFailed")}</p> : null}
        {searched && !failed && hits && hits.length === 0 ? (
          <p className="text-grey text-sm">{t("noResults")}</p>
        ) : null}
        {searched && !failed && hits && hits.length > 0 ? (
          <p className="sr-only">{t("results", { count: hits.length })}</p>
        ) : null}
      </div>
      {searched && hits && hits.length > 0 ? (
        <ul className="divide-line max-h-80 divide-y overflow-y-auto">
          {hits.map((hit) => (
            <li key={hit.id}>
              <Link
                href={`/admin/membres/${hit.id}`}
                prefetch={false}
                onClick={close}
                className="hover:bg-ink flex min-h-11 flex-col justify-center rounded-md px-2 py-2"
              >
                <span className="font-semibold">{hit.pseudo}</span>
                <span className="text-grey text-xs">{hit.meta}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}
