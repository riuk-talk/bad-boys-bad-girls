"use client";

import { Ban, Ellipsis, Flag, FolderX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { ReportDialog } from "@/components/relations/report-dialog";
import { BlockDialog } from "@/components/relations/safety-actions";

type Props = {
  memberId: string;
  pseudo: string;
  /** The request of the case: what « Signaler » reports. */
  requestId: string;
  /** « Affaire classée » (Parloir sans horaire only): opens its confirmation. */
  onCloseCase?: () => void;
};

/**
 * The « ⋯ » of the plate at the top of the Parloir (9l): Affaire classée (Parloir sans horaire),
 * Signaler and Bloquer, out of the way of the conversation. A disclosure: the button says whether
 * it is open, Escape and a touch outside close it, the focus goes back to the button.
 */
export function PlateMenu({ memberId, pseudo, requestId, onCloseCase }: Props) {
  const t = useTranslations("Relations.parloir");
  const ts = useTranslations("Relations.safety");
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"report" | "block" | null>(null);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const choose = (next: () => void) => {
    setOpen(false);
    next();
  };
  const item =
    "text-cream hover:bg-ink-2 flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-[15px]";
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-label={t("plateMenu", { pseudo })}
        onClick={() => setOpen((value) => !value)}
        className="text-cream hover:text-accent flex size-11 items-center justify-center rounded-md"
      >
        <Ellipsis aria-hidden="true" className="size-6" />
      </button>
      {open ? (
        <ul
          id={`${id}-menu`}
          className="border-line bg-ink absolute top-12 right-0 z-30 w-64 overflow-hidden rounded-md border py-1 shadow-[0_10px_24px_rgb(0_0_0/0.6)]"
        >
          {onCloseCase ? (
            <li>
              <button type="button" className={item} onClick={() => choose(onCloseCase)}>
                <FolderX aria-hidden="true" className="size-4 shrink-0" />
                <span className="flex flex-col">
                  <span>{t("closeCase")}</span>
                  <span className="text-grey text-xs">{t("closeCaseHint")}</span>
                </span>
              </button>
            </li>
          ) : null}
          <li>
            <button
              type="button"
              className={item}
              onClick={() => choose(() => setDialog("report"))}
            >
              <Flag aria-hidden="true" className="size-4 shrink-0" />
              {ts("report")}
            </button>
          </li>
          <li>
            <button type="button" className={item} onClick={() => choose(() => setDialog("block"))}>
              <Ban aria-hidden="true" className="size-4 shrink-0" />
              {ts("block")}
            </button>
          </li>
        </ul>
      ) : null}
      <ReportDialog
        open={dialog === "report"}
        onClose={() => setDialog(null)}
        pseudo={pseudo}
        reportType="visit_request"
        reportTarget={requestId}
      />
      <BlockDialog
        open={dialog === "block"}
        onClose={() => setDialog(null)}
        memberId={memberId}
        pseudo={pseudo}
        afterBlock="/visites"
      />
    </div>
  );
}
