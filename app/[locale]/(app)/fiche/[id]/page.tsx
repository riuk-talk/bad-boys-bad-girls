import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FicheScreen } from "@/components/relations/fiche-screen";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Relations.fiche" });
  return { title: t("metaTitle") };
}

/** A Bad's Fiche on its own page: a shared link, a reload, or reached from anywhere. */
export default async function FichePage({ params }: Props) {
  const { id } = await params;
  return <FicheScreen id={id} />;
}
