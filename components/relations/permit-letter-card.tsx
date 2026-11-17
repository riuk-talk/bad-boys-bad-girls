import { Check, UserRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Mugshot } from "@/components/brand/mugshot";
import { accentForGender } from "@/lib/accent";
import { tribeText, type PermitView } from "@/lib/relations/types";

type Props = {
  /** What a Bad may read of a Visitor's Permis (get_permit, or the admin's view of it). */
  permit: Pick<
    PermitView,
    | "pseudo"
    | "gender"
    | "age"
    | "photo"
    | "motive"
    | "tribes"
    | "clean_record"
    | "visits_honored"
    | "visits_due"
  >;
  photo: string | null;
  /** The town, with the distance when the reader is a Bad. */
  place: string | null;
  locale: string;
  headingLevel: 1 | 2;
  headingId: string;
  priority?: boolean;
};

/**
 * The Permis de visite as a Bad reads it in its Courrier (SPEC §7, maquette LireDemande.dc.html):
 * photo, pseudo and age, town, « Casier vierge », visits honoured, Motif de visite, signes
 * distinctifs. Never the Visitor's own search criteria. Shared with the admin's « Voir comme un
 * Bad » (10f-bis), so both show the same card.
 */
export async function PermitLetterCard({
  permit,
  photo,
  place,
  locale,
  headingLevel,
  headingId,
  priority = false,
}: Props) {
  const t = await getTranslations("Relations.letter");
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section
      aria-labelledby={headingId}
      data-accent={accentForGender(permit.gender)}
      className="bg-cream text-ink flex flex-col gap-3 rounded-md p-4"
    >
      <div className="flex items-center justify-between border-b-2 border-[#cfc4ae] pb-2">
        <span className="font-stamp text-[13px] tracking-[0.15em]">{t("permit")}</span>
        <span className="font-stamp text-green-ink -rotate-3 border-2 border-current px-1.5 py-0.5 text-[11px]">
          {t("deliveredByGreffe")}
        </span>
      </div>
      <div className="flex gap-3.5">
        {photo ? (
          <Mugshot
            src={photo}
            alt={t("photoAlt", { pseudo: permit.pseudo })}
            cutout={permit.photo?.cutout === true}
            priority={priority}
            className="h-[136px] w-[110px] shrink-0 rounded-[3px]"
          />
        ) : (
          <div className="relative flex h-[136px] w-[110px] shrink-0 items-end justify-center overflow-hidden rounded-[3px] bg-[#2a2a2e]">
            <UserRound aria-hidden="true" className="text-cream/40 size-24" strokeWidth={1.2} />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Heading
            id={headingId}
            className="font-display text-[28px] leading-none text-[var(--color-accent-ink)] uppercase"
          >
            {permit.age !== null
              ? t("nameAge", { pseudo: permit.pseudo, age: permit.age })
              : permit.pseudo}
          </Heading>
          {place ? <span className="text-sm text-[#4a4038]">{place}</span> : null}
          {permit.clean_record ? (
            <span className="text-green-ink inline-flex items-center gap-1.5 text-[13px] font-bold">
              <Check aria-hidden="true" className="size-4" />
              {t("cleanRecord")}
            </span>
          ) : null}
          <span className="text-[13px] font-bold text-[#4a4038]">
            {permit.visits_due > 0
              ? t("honored", { honored: permit.visits_honored, due: permit.visits_due })
              : t("newVisitor")}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-stamp text-xs tracking-[0.15em] text-[#6a5f55]">{t("motive")}</span>
        <p className="text-[15px] leading-normal">{permit.motive}</p>
      </div>
      {permit.tribes.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("signs")}>
          {permit.tribes.map((tribe) => (
            <li
              key={tribeText(tribe, "fr")}
              className="inline-flex min-h-[30px] items-center rounded-full border border-[#cfc4ae] px-2.5 text-xs text-[#4a4038]"
            >
              {tribeText(tribe, locale, permit.gender)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
