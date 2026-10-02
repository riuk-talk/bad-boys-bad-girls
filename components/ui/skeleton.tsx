import { cn } from "@/lib/cn";

/** Loading placeholder. Purely decorative: pair it with an accessible loading label. */
export function Skeleton({
  className,
  rounded = "rounded-md",
}: {
  className?: string;
  rounded?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("bg-ink-3 animate-pulse motion-reduce:animate-none", rounded, className)}
    />
  );
}

export function FicheCardSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="w-full max-w-sm">
      <Skeleton className="aspect-[4/5] w-full" rounded="rounded-t-[var(--radius-card)]" />
      <div className="bg-ink-2 space-y-3 rounded-b-[var(--radius-card)] p-4">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  );
}
