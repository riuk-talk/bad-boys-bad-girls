import { Paperclip, UserRound } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { caseNumberFromId } from "@/lib/case-number";
import { cn } from "@/lib/cn";
import { Stamp } from "./stamp";
import { Toise } from "./toise";

export type FicheCardData = {
  id: string;
  pseudo: string;
  age: number;
  city: string;
  photo?: { src: string; width: number; height: number } | null;
  signs: string[];
  charges: string[];
  bio?: string | null;
  isReglo?: boolean;
};

/**
 * The Fiche as a case file (SPEC §1 bis): aged paper, black header band, case number,
 * paperclip, ID photo on the height chart. Vertical on mobile, landscape from 1024 px.
 */
export function FicheCard({ data, className }: { data: FicheCardData; className?: string }) {
  const t = useTranslations("Components.fiche");
  const caseNumber = caseNumberFromId(data.id);

  return (
    <article
      aria-labelledby={`fiche-${data.id}-title`}
      className={cn(
        "paper relative overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-paper)] lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]",
        className,
      )}
    >
      <Paperclip
        aria-hidden="true"
        className="text-grey-ink absolute top-2 right-4 z-10 size-9 rotate-[20deg]"
        strokeWidth={1.75}
      />
      <div className="relative aspect-[4/5] lg:aspect-auto lg:min-h-full">
        <Toise />
        {data.photo ? (
          <Image
            src={data.photo.src}
            alt={t("photoAlt", { pseudo: data.pseudo })}
            width={data.photo.width}
            height={data.photo.height}
            sizes="(min-width: 1024px) 40vw, 100vw"
            loading="lazy"
            unoptimized
            className="relative size-full object-cover"
          />
        ) : (
          <div className="relative flex size-full items-end justify-center">
            <UserRound aria-hidden="true" className="text-cream/25 h-3/4 w-3/4" strokeWidth={1} />
          </div>
        )}
      </div>
      <div className="flex flex-col">
        <header className="bg-ink text-cream px-5 pt-4 pb-3">
          <p className="font-stamp text-gold text-sm tracking-widest">
            {t("caseNumber", { number: caseNumber })}
          </p>
          <h3
            id={`fiche-${data.id}-title`}
            className="font-display text-3xl tracking-wide uppercase"
          >
            {data.pseudo}
          </h3>
          <p className="text-grey">
            {t("age", { age: data.age })} · {data.city}
          </p>
        </header>
        <div className={cn("relative space-y-5 py-5 pl-5", data.isReglo ? "pr-24" : "pr-5")}>
          {data.isReglo ? (
            <span className="absolute top-3 right-4">
              <Stamp kind="reglo" surface="paper" size="sm" tilt={10} />
            </span>
          ) : null}
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
          {data.charges.length > 0 ? (
            <section>
              <h4 className="text-grey-ink text-sm font-bold tracking-[0.18em] uppercase">
                {t("charges")}
              </h4>
              <ol className="font-stamp mt-2 space-y-2">
                {data.charges.map((charge, index) => (
                  <li key={charge} className="flex gap-2">
                    <span aria-hidden="true" className="text-red-ink">
                      {index + 1}.
                    </span>
                    <span>{charge}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {data.bio ? (
            <section>
              <h4 className="text-grey-ink text-sm font-bold tracking-[0.18em] uppercase">
                {t("bio")}
              </h4>
              <p className="mt-2">{data.bio}</p>
            </section>
          ) : null}
        </div>
      </div>
    </article>
  );
}
