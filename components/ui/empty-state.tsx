import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  title,
  body,
  icon,
  action,
  className,
}: {
  title: ReactNode;
  body?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-line flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? (
        <div aria-hidden="true" className="text-accent">
          {icon}
        </div>
      ) : null}
      <h2 className="font-display text-2xl tracking-wide uppercase">{title}</h2>
      {body ? <p className="text-grey max-w-prose">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
