import { getTranslations } from "next-intl/server";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { Constants, type Database } from "@/lib/supabase/database.types";

type Gender = Database["public"]["Enums"]["gender"];

/** « Tu cherches : … · Modifier » (10d), above the Découverte and the Promenade. */
export async function CriteriaBar({
  genders,
  ageMin,
  ageMax,
}: {
  genders: Gender[];
  ageMin: number;
  ageMax: number;
}) {
  const t = await getTranslations("Criteria");
  const sought = Constants.public.Enums.gender
    .filter((gender) => genders.includes(gender))
    .map((gender) => t(`genders.${gender}`))
    .join(", ");
  return (
    <p className="border-line text-cream/85 rounded-md border px-4 py-2 text-center text-sm">
      {t("bar", { genders: sought, min: ageMin, max: ageMax })}
      {" · "}
      <LocalizedLink
        href="/ma-fiche/criteres"
        className="text-cream font-semibold underline underline-offset-4"
      >
        {t("edit")}
      </LocalizedLink>
    </p>
  );
}
