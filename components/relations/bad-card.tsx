import { UserRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Mugshot } from "@/components/brand/mugshot";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { accentForGender } from "@/lib/accent";
import { cn } from "@/lib/cn";
import type { Gender } from "@/lib/relations/types";

export type BadCardData = {
  id: string;
  pseudo: string;
  gender: Gender;
  age: number | null;
  city: string | null;
  distanceKm: number | null;
  photoUrl: string | null;
  complicity: number | null;
  goodConduct: boolean;
  requestsOpen: boolean;
};

/**
 * A Bad in the Promenade or the Découverte: the face on the graduated wall, with a mini placard
 * (pseudo, age, quartier) like the Fiche's (FichePancarte.dc.html). What represents a person
 * takes the colour of that person's gender (PARCOURS-DESIGN §1).
 */
export async function BadCard({
  bad,
  size = "small",
  priority = false,
}: {
  bad: BadCardData;
  size?: "large" | "small";
  priority?: boolean;
}) {
  const t = await getTranslations("Relations.card");
  const large = size === "large";
  const place = [bad.city, bad.distanceKm !== null ? t("distance", { km: bad.distanceKm }) : null]
    .filter(Boolean)
    .join(", ");
  const line = [bad.age !== null ? t("age", { age: bad.age }) : null, place || null]
    .filter(Boolean)
    .join(" · ");
  return (
    <LocalizedLink
      href={`/fiche/${bad.id}`}
      data-accent={accentForGender(bad.gender)}
      className="border-line focus-visible:outline-accent block overflow-hidden rounded-md border border-t-4 border-t-[var(--color-accent)] hover:border-[var(--color-accent)]"
    >
      <div className={cn("mugshot-wall relative", large ? "aspect-[4/3.4]" : "aspect-[4/5]")}>
        {bad.photoUrl ? (
          // The cards do not know whether the photo is cut out: framed on the face either way.
          <Mugshot src={bad.photoUrl} alt="" cutout fill top priority={priority} />
        ) : (
          <UserRound
            aria-hidden="true"
            className="absolute inset-x-0 top-[6%] mx-auto h-3/5 w-4/5 text-[#26262a]"
            strokeWidth={1.2}
          />
        )}
        {bad.goodConduct ? (
          <span className="font-display absolute top-2 left-2 rotate-[-6deg] rounded-sm border-2 border-[#e0233f] bg-[#efe6d2]/90 px-1.5 py-0.5 text-[11px] leading-none text-[#b5172e] uppercase">
            {t("goodConduct")}
          </span>
        ) : null}
        {bad.complicity !== null ? (
          <span className="text-cream absolute top-2 right-2 rounded-full bg-black/80 px-2 py-0.5 text-xs font-bold">
            {large
              ? t("complicity", { score: bad.complicity })
              : t("percent", { score: bad.complicity })}
          </span>
        ) : null}
        <div
          className={cn(
            "placard-board placard-letters absolute inset-x-[7%] bottom-[5%] flex flex-col",
            large ? "gap-1 px-3.5 py-2.5" : "gap-0.5 px-2 py-1.5",
          )}
        >
          <span
            className={cn(
              "leading-none break-words text-[var(--color-accent-board)]",
              large ? "text-[26px]" : "text-[15px]",
            )}
          >
            {bad.pseudo}
          </span>
          {line ? (
            <span className={cn("tracking-[0.06em]", large ? "text-[13px]" : "text-[11px]")}>
              {line}
            </span>
          ) : null}
          {!bad.requestsOpen ? (
            <span className="text-[11px] tracking-[0.06em] text-[#dcd6ca]">{t("full")}</span>
          ) : null}
        </div>
      </div>
    </LocalizedLink>
  );
}
