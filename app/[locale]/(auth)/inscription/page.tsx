import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignupForm } from "@/components/auth/auth-forms";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ parrain?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("signupTitle") };
}

export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  const { parrain } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Auth");
  return (
    <>
      <h1 className="font-display text-4xl tracking-wide uppercase">{t("signupTitle")}</h1>
      <p className="text-cream/85 mt-2 mb-8">{t("signupLead")}</p>
      <SignupForm referralCode={parrain?.slice(0, 8)} />
    </>
  );
}
