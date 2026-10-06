import { UserRound } from "lucide-react";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
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
 * A Bad in the Promenade or the Découverte (maquette Promenade.dc.html). What represents a person
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
    .join(" · ");
  return (
    <LocalizedLink
      href={`/fiche/${bad.id}`}
      data-accent={accentForGender(bad.gender)}
      className="border-line bg-ink-2 focus-visible:outline-accent flex flex-col overflow-hidden rounded-md border border-t-4 border-t-[var(--color-accent)] hover:border-[var(--color-accent)]"
    >
      <div
        className={cn("yard-wall relative flex items-end justify-center", large ? "h-52" : "h-28")}
      >
        {bad.photoUrl ? (
          <Image
            src={bad.photoUrl}
            alt=""
            fill
            sizes={large ? "(min-width: 768px) 40rem, 100vw" : "(min-width: 768px) 20rem, 50vw"}
            unoptimized
            priority={priority}
            className="object-cover"
          />
        ) : (
          <UserRound aria-hidden="true" className="text-cream/25 h-4/5 w-4/5" strokeWidth={1} />
        )}
        {large && bad.goodConduct ? (
          <span className="font-stamp text-accent absolute top-2.5 left-2.5 -rotate-3 border-2 border-current bg-black/60 px-2 py-0.5 text-[11px] tracking-wider">
            {t("goodConduct")}
          </span>
        ) : null}
        {large && bad.complicity !== null ? (
          <span className="text-cream absolute top-2.5 right-2.5 rounded-full bg-black/80 px-2.5 py-1 text-[13px] font-bold">
            {t("complicity", { score: bad.complicity })}
          </span>
        ) : null}
        {!bad.requestsOpen ? (
          <span className="font-stamp text-cream absolute bottom-2 left-2 rounded-sm bg-black/80 px-2 py-0.5 text-[11px] tracking-wider">
            {t("full")}
          </span>
        ) : null}
      </div>
      {large ? (
        <div className="flex items-baseline justify-between gap-3 px-3.5 py-3">
          <span className="font-display text-accent text-[22px] uppercase">
            {bad.age !== null ? t("nameAge", { pseudo: bad.pseudo, age: bad.age }) : bad.pseudo}
          </span>
          <span className="text-grey text-[13px]">{place}</span>
        </div>
      ) : (
        <div className="px-2.5 py-2">
          <p className="text-cream text-sm font-bold">
            {bad.age !== null ? t("nameAge", { pseudo: bad.pseudo, age: bad.age }) : bad.pseudo}
          </p>
          <p className="text-grey text-xs">
            {[bad.city, bad.complicity !== null ? t("percent", { score: bad.complicity }) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}
    </LocalizedLink>
  );
}
