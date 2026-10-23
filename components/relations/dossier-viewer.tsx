"use client";

import { Maximize2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The Fiche sheet (components/relations/dossier.tsx) in the page. On a phone held upright it is a
 * miniature, with « Voir le dossier en grand » that opens it full screen (scrollable both ways,
 * Escape or « Fermer » to close, focus kept inside); a phone turned sideways or a large screen
 * shows it at full width, without the button. The same content either way: nothing is duplicated
 * for screen readers.
 */
export function DossierViewer({ pseudo, children }: { pseudo: string; children: ReactNode }) {
  const t = useTranslations("Relations.dossier");
  const [open, setOpen] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  function close() {
    setOpen(false);
    requestAnimationFrame(() => openButton.current?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !frame.current) return;
    const items = [...frame.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={frame}
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? t("largeLabel", { pseudo }) : undefined}
        onKeyDown={onKeyDown}
        className={cn(open && "fixed inset-0 z-[60] overflow-auto bg-[#0e0e10] p-2")}
        data-testid="dossier-frame"
        data-open={open ? "true" : undefined}
      >
        {open ? (
          <div className="sticky top-0 left-0 z-10 mb-2 flex items-center justify-between gap-3">
            <button
              ref={closeButton}
              type="button"
              onClick={close}
              className="bg-cream text-ink focus-visible:outline-accent inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 font-semibold focus-visible:outline-3"
            >
              <X aria-hidden="true" className="size-4" />
              {t("closeLarge")}
            </button>
            <p className="text-cream/85 text-xs portrait:block landscape:hidden">
              {t("rotateHint")}
            </p>
          </div>
        ) : null}
        <div className={open ? "w-[max(100%,960px)]" : undefined}>{children}</div>
      </div>
      {open ? null : (
        <button
          ref={openButton}
          type="button"
          onClick={() => setOpen(true)}
          className="border-cream/80 text-cream hover:bg-cream hover:text-ink focus-visible:outline-accent hidden min-h-11 items-center justify-center gap-2 self-center rounded-full border-2 px-5 font-semibold focus-visible:outline-3 portrait:max-md:inline-flex"
        >
          <Maximize2 aria-hidden="true" className="size-4" />
          {t("viewLarge")}
        </button>
      )}
    </div>
  );
}
