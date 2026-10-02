import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginForm } from "@/components/auth/auth-forms";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ erreur?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("loginTitle") };
}

export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  const { erreur } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Auth");
  return (
    <>
      <h1 className="font-display text-4xl tracking-wide uppercase">{t("loginTitle")}</h1>
      <p className="text-cream/85 mt-2 mb-8">{t("loginLead")}</p>
      <LoginForm initialMessage={erreur === "lien" ? "linkInvalid" : undefined} />
    </>
  );
}
