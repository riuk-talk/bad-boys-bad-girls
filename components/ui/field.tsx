import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type FieldProps = {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Label + control + hint + error, with the ids wired for assistive technologies. */
export function Field({ id, label, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-cream text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-grey text-sm">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-red-bright text-sm font-medium" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, hint?: unknown, error?: unknown): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

/** Control styles without horizontal padding, so callers can reserve room for an icon. */
export const controlBase =
  "min-h-11 w-full rounded-lg border border-line bg-ink-2 py-2.5 text-base text-cream placeholder:text-grey focus-visible:border-accent aria-invalid:border-red-bright";

export const controlClasses = `${controlBase} px-3.5`;
