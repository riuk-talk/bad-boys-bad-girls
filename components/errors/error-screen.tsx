import type { ReactNode } from "react";
import { Stamp, type StampKind } from "@/components/brand/stamp";

/** Branded error body (404). The 500 boundary (app/[locale]/error.tsx) is self-contained. */
export function ErrorScreen({
  stamp,
  title,
  body,
  action,
}: {
  stamp: StampKind;
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 overflow-x-clip px-4 py-16 text-center sm:py-24">
      <Stamp kind={stamp} size="lg" animated tilt={-6} />
      <h1 className="font-display text-4xl tracking-wide uppercase sm:text-5xl">{title}</h1>
      <p className="text-cream/85 text-lg">{body}</p>
      {action}
    </div>
  );
}
