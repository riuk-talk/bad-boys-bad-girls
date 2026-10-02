import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ListDocument } from "@/components/content/list-document";

type Props = { params: Promise<{ locale: string }> };

// Public but not indexed (decision 14: only landing, legal pages and the Charter).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Safety" });
  return { title: t("title") };
}

export default async function SafetyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Safety");
  return <ListDocument namespace="Safety" footnote={t("numbersCheck")} />;
}
