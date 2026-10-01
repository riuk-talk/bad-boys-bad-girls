import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ListDocument } from "@/components/content/list-document";
import { indexableMetadata } from "@/lib/seo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Charter" });
  return { title: t("title"), ...indexableMetadata(locale, "/charte") };
}

export default async function CharterPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ListDocument namespace="Charter" />;
}
