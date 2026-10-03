import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NewPasswordForm } from "@/components/auth/auth-forms";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("newPasswordTitle") };
}

// Reached from the password-reset e-mail (session opened by /api/auth/confirm).
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Auth");
  return (
    <>
      <h1 className="font-display text-4xl tracking-wide uppercase">{t("newPasswordTitle")}</h1>
      <p className="text-cream/85 mt-2 mb-8">{t("newPasswordLead")}</p>
      <NewPasswordForm />
    </>
  );
}
