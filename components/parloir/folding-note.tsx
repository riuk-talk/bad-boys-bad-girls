"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

/** Per conversation and per note, in this browser only (a comfort, never a rule). */
function storageKey(conversationId: string, note: string) {
  return `parloir:${conversationId}:read:${note}`;
}

/**
 * Whether something of the Parloir was already read on an earlier opening (`openedAt`): it then
 * starts folded. The first time, it is remembered for the next openings. The state can be
 * changed (unfold, fold again) for this opening only. Shared by the notes and the Cavale (9l).
 */
export function useFoldedOnReopen(
  conversationId: string,
  note: string,
  openedAt: number,
  /** Nothing to remember yet (no accepted Cavale): nothing is written. */
  enabled = true,
) {
  const [folded, setFolded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const key = storageKey(conversationId, note);
    try {
      const readAt = Number(window.localStorage.getItem(key) ?? 0);
      if (readAt > 0 && readAt < openedAt) {
        // Read on an earlier opening: folded (the first paint shows it in full).
        // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage, read after hydration
        setFolded(true);
      } else if (readAt === 0) {
        window.localStorage.setItem(key, String(Date.now()));
      }
    } catch {
      // No storage: it stays in full.
    }
  }, [conversationId, note, openedAt, enabled]);

  return [folded, setFolded] as const;
}

/**
 * A note of the Parloir (safety, money, the relance) shown in full the first time, then folded
 * into one line the next times the Parloir is opened, so the conversation has the room (9l).
 * Read « before » means before this opening of the Parloir (`openedAt`): a note that appears
 * during the visit (the money one, after a Cavale) stays in full until the next opening. Folded,
 * it is a button that opens it again. Without storage (private browsing), it stays in full.
 */
export function FoldingNote({
  conversationId,
  note,
  openedAt,
  icon,
  summary,
  children,
  className,
}: {
  conversationId: string;
  /** « safety », « money », « nudge »: what is remembered. */
  note: string;
  /** When this opening of the Parloir started (Date.now() at its mount). */
  openedAt: number;
  icon: ReactNode;
  /** The one line shown once read. */
  summary: string;
  children: ReactNode;
  className?: string;
}) {
  const [folded, setFolded] = useFoldedOnReopen(conversationId, note, openedAt);

  if (!folded) {
    return (
      <div role="note" className={className} data-note={note} data-folded="false">
        {children}
      </div>
    );
  }
  return (
    <div data-note={note} data-folded="true">
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setFolded(false)}
        className="text-grey hover:text-cream flex min-h-11 w-full items-center justify-center gap-2 text-[13px]"
      >
        {icon}
        <span className="truncate">{summary}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
      </button>
    </div>
  );
}
