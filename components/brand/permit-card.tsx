import { UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { caseNumberFromId } from "@/lib/case-number";
import { cn } from "@/lib/cn";
import { Mugshot } from "./mugshot";
import { Stamp } from "./stamp";

export type PermitCardData = {
  id: string;
  pseudo: string;
  age: number;
  city: string;
  photo?: { src: string; width: number; height: number; cutout?: boolean } | null;
  motive: string;
  signs: string[];
  /** Photo validated by the Greffe: the Permis is delivered (SPEC v7 §5 bis). */
  delivered: boolean;
  cleanRecord: boolean;
  /** Visites honorées X/Y; null before the first visit that reached its time. */
  visits: { honored: number; due: number } | null;
};

/**
 * The Visitor's Permis de visite (SPEC v7 §1 bis, §5 bis): a cartoon pass, never a copy of a real
 * document (no tricolour band, no official wording). One photo only.
 */
export function PermitCard({ data, className }: { data: PermitCardData; className?: string }) {
  const t = useTranslations("Components.permit");
  return (
    <article
      aria-labelledby={`permit-${data.id}-title`}
      className={cn(
        "paper relative overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-paper)]",
        className,
      )}
    >
      <header className="bg-ink text-cream flex items-center justify-between gap-3 px-5 py-3">
        <p className="font-display text-gold text-xl tracking-wide uppercase">{t("title")}</p>
        <p className="font-stamp text-grey text-sm tracking-widest">
          {t("number", { number: caseNumberFromId(data.id) })}
        </p>
      </header>
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 p-5 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <div className="bg-ink-3 relative aspect-[4/5] overflow-hidden rounded-md">
          {data.photo ? (
            <Mugshot
              src={data.photo.src}
              alt={t("photoAlt", { pseudo: data.pseudo })}
              cutout={data.photo.cutout === true}
              fill
            />
          ) : (
            <div className="flex size-full items-end justify-center">
              <UserRound aria-hidden="true" className="text-cream/25 h-3/4 w-3/4" strokeWidth={1} />
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <h3
            id={`permit-${data.id}-title`}
            className="font-display text-3xl tracking-wide break-words uppercase"
          >
            {data.pseudo}
          </h3>
          <p className="text-grey-ink">
            {t("age", { age: data.age })} · {data.city}
          </p>
          <ul className="flex flex-wrap gap-2 text-sm font-semibold">
            {data.cleanRecord ? (
              <li className="border-gold-ink text-gold-ink rounded-full border px-2.5 py-0.5">
                {t("cleanRecord")}
              </li>
            ) : null}
            <li className="border-grey-ink text-grey-ink rounded-full border px-2.5 py-0.5">
              {data.visits
                ? t("visitsHonored", { honored: data.visits.honored, due: data.visits.due })
                : t("newVisitor")}
            </li>
          </ul>
        </div>
      </div>
      <div className="space-y-4 px-5 pb-5">
        <section>
          <h4 className="text-grey-ink text-sm font-bold tracking-[0.18em] uppercase">
            {t("motive")}
          </h4>
          <p className="mt-2">{data.motive}</p>
        </section>
        {data.signs.length > 0 ? (
          <section>
            <h4 className="text-grey-ink text-sm font-bold tracking-[0.18em] uppercase">
              {t("distinctiveSigns")}
            </h4>
            <ul className="mt-2 space-y-1">
              {data.signs.map((sign) => (
                <li key={sign}>{sign}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="flex justify-end">
          {data.delivered ? (
            <Stamp kind="permit" surface="paper" size="sm" tilt={-6} />
          ) : (
            <p className="font-stamp text-grey-ink text-sm tracking-widest uppercase">
              {t("pending")}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
