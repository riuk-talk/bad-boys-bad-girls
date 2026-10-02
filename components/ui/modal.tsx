"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Native <dialog>: focus trap, Escape and inert background come from the browser.
 * Focus returns to the element that opened it.
 */
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const t = useTranslations("Common");
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "border-line bg-ink-2 text-cream backdrop:bg-ink/80 open:animate-fade m-auto w-[min(100%-2rem,32rem)] rounded-[var(--radius-card)] border p-0 shadow-[var(--shadow-paper)]",
        className,
      )}
    >
      <div className="border-line flex items-start justify-between gap-4 border-b px-5 py-4">
        <h2 id={titleId} className="font-display text-2xl tracking-wide uppercase">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="text-grey hover:text-cream -m-2 inline-flex size-11 items-center justify-center rounded-full"
        >
          <X aria-hidden="true" className="size-6" />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
