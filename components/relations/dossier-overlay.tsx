"use client";

import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { accentForGender } from "@/lib/accent";
import type { Gender } from "@/lib/relations/types";

/**
 * Back to the Découverte: the folder was opened by a navigation from it (an intercepted route),
 * so going back closes it and the list is still where it was, scrolled as it was. The phone's
 * back button does the same.
 */
function useCloseDossier() {
  const router = useRouter();
  return () => router.back();
}

export function CloseDossier() {
  const t = useTranslations("Relations.fichePage");
  const close = useCloseDossier();
  return (
    <button
      type="button"
      onClick={close}
      className="focus-visible:outline-accent inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[#0e0e10]/80 px-3.5 text-sm font-bold text-[#f2e8d5] focus-visible:outline-3"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      {t("closeDossier")}
    </button>
  );
}

/**
 * La Découverte en dossiers (owner's decision 2026-10-24, DecouverteDossiers.dc.html): the folder
 * fills the screen and its kraft cover turns on its left edge (0.9 s) to show the Fiche v7. A
 * native modal dialog: the page behind is inert, the focus stays inside, Escape closes (unless the
 * placard or the flag menu of the Fiche takes it first). With less motion asked, it opens at once.
 */
export function DossierOverlay({
  label,
  cover,
  children,
}: {
  label: string;
  cover: { pseudo: string; line: string; ecrou: string; gender: Gender };
  children: ReactNode;
}) {
  const t = useTranslations("Relations.fichePage");
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useCloseDossier();
  // 0: cover closed, 1: turning, 2: gone.
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // The page behind keeps its scroll position (and stops scrolling) while the folder is open.
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers = reduced
      ? [window.setTimeout(() => setPhase(2), 0)]
      : [window.setTimeout(() => setPhase(1), 60), window.setTimeout(() => setPhase(2), 1000)];
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      root.style.overflow = previous;
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-x-hidden overflow-y-auto overscroll-contain bg-[#0e0e10] p-0 text-[#f2e8d5] backdrop:bg-[#0e0e10]"
      data-testid="dossier-open"
      data-phase={phase}
    >
      <div className="relative min-h-full [perspective:1400px]">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
        {phase < 2 ? (
          <div
            aria-hidden="true"
            data-accent={accentForGender(cover.gender)}
            className="dossier-cover kraft fixed inset-0 z-50"
            style={{ transform: phase >= 1 ? "rotateY(-165deg)" : "none" }}
            data-testid="dossier-cover"
          >
            <div className="fiche-paper absolute top-[36%] right-10 left-10 py-3.5 pr-4 pl-6 shadow-[0_4px_10px_rgb(0_0_0/0.35)]">
              <span className="absolute inset-y-0 left-0 w-2 bg-[var(--color-accent)]" />
              <p className="font-stamp text-[12px] tracking-[0.15em]">{t("caseFile")}</p>
              <p className="font-stamp mt-1.5 text-[26px] font-bold break-words">{cover.pseudo}</p>
              <p className="font-stamp mt-1 text-[14px]">{cover.line}</p>
              <p className="font-stamp mt-1 text-[12px] text-[#5a5046]">
                {t("ecrou", { ecrou: cover.ecrou })}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
