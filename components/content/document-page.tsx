import type { ReactNode } from "react";

/** Long-form page shell shared by legal pages, the Charter and the safety tips. */
export function DocumentPage({
  title,
  lead,
  banner,
  children,
}: {
  title: string;
  lead?: string;
  banner?: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="font-display text-4xl tracking-wide uppercase sm:text-5xl">{title}</h1>
      {banner ? (
        <p className="border-gold/60 bg-gold/10 text-gold mt-4 rounded-lg border px-4 py-3">
          {banner}
        </p>
      ) : null}
      {lead ? <p className="text-cream/90 mt-4 text-lg">{lead}</p> : null}
      <div className="mt-8 space-y-8">{children}</div>
    </article>
  );
}

export function DocumentSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-gold text-2xl tracking-wide uppercase">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
