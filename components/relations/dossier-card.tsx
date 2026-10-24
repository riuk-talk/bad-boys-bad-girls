import { UserRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { LocalizedLink } from "@/components/i18n/localized-link";
import type { BadCardData } from "@/components/relations/bad-card";
import { accentForGender } from "@/lib/accent";
import { tiltOf } from "@/lib/relations/dossier";

/**
 * A Bad in the Découverte as a kraft folder (owner's decision 2026-10-24,
 * DecouverteDossiers.dc.html): the face on the height-chart wall in a white frame, tilted, held
 * by a paper clip; BONNE CONDUITE if earned; a typed paper label with a strip in the colour of
 * the Bad's gender. It opens the Fiche at its own URL (/fiche/[id]): over the Découverte as a
 * folder (intercepted route), or on its own page when the link is shared or reloaded.
 */
export async function DossierCard({
  bad,
  priority = false,
}: {
  bad: BadCardData;
  priority?: boolean;
}) {
  const t = await getTranslations("Relations.card");
  const place = bad.distanceKm !== null ? t("distance", { km: bad.distanceKm }) : null;
  const short = [bad.age !== null ? t("age", { age: bad.age }) : null, bad.city]
    .filter(Boolean)
    .join(" · ");
  const full = [short, place].filter(Boolean).join(" · ");
  return (
    <LocalizedLink
      href={`/fiche/${bad.id}`}
      scroll={false}
      aria-label={t("openDossier", { pseudo: bad.pseudo, line: full })}
      data-accent={accentForGender(bad.gender)}
      className="kraft relative block h-[232px] overflow-hidden rounded shadow-[0_10px_18px_rgb(0_0_0/0.55)] transition-transform duration-200 [contain-intrinsic-size:auto_232px] [content-visibility:auto] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#e8b84a] active:scale-[0.97] motion-reduce:transition-none"
      data-testid="dossier-card"
    >
      <span
        className="mugshot-wall absolute top-6 left-4 h-32 w-[118px] overflow-hidden border-4 border-b-[12px] border-[#fbf8f1] shadow-[0_6px_10px_rgb(0_0_0/0.4)]"
        style={{ transform: `rotate(${tiltOf(bad.id)}deg)` }}
      >
        {bad.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-optimised WebP from the photos bucket
          <img
            src={bad.photoUrl}
            alt=""
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className="absolute inset-0 size-full object-cover object-top"
          />
        ) : (
          <UserRound
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 mx-auto h-[85%] w-full text-[#202024]"
            strokeWidth={1.1}
          />
        )}
      </span>
      <span
        aria-hidden="true"
        className="fiche-sprite top-2 left-[30px] h-[43px] w-[34px] -rotate-6 bg-[length:195px_98px] bg-[position:-15px_-10px]"
      />
      {bad.goodConduct ? (
        <span
          aria-hidden="true"
          className="fiche-stamp font-display absolute top-[34px] right-1.5 rotate-12 px-[7px] py-[5px] text-[9px] leading-none text-[#b5172e]"
        >
          <span className="block rounded-sm bg-[#f2e8d5]/85 px-0.5">
            {t("goodConduct1")}
            <br />
            {t("goodConduct2")}
          </span>
        </span>
      ) : null}
      <span className="fiche-paper absolute inset-x-2.5 bottom-3 block py-1.5 pr-2 pl-3 text-[#1a1714] shadow-[0_2px_4px_rgb(0_0_0/0.3)]">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[5px] bg-[var(--color-accent)]"
        />
        <span className="font-stamp block truncate text-[15px] leading-tight font-bold">
          {bad.pseudo}
        </span>
        <span className="font-stamp mt-0.5 block truncate text-[11px] leading-snug">{short}</span>
        {place ? (
          <span className="font-stamp block truncate text-[11px] text-[#5a5046]">{place}</span>
        ) : null}
        {!bad.requestsOpen ? (
          <span className="font-stamp block truncate text-[11px] text-[#5a5046]">{t("full")}</span>
        ) : null}
      </span>
    </LocalizedLink>
  );
}
