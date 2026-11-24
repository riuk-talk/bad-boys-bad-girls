import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PasswordChange } from "@/components/app/account-security";
import { ButtonLink } from "@/components/ui/button-link";
import { requireMemberArea } from "@/lib/auth/user";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "AccountSecurity.password" });
  return { title: t("title") };
}

/** Ma fiche › Mon compte › Changer de mot de passe (10j, question 10-22). */
export default async function PasswordPage() {
  await requireMemberArea();
  const t = await getTranslations("AccountSecurity");
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("password.title")}</h1>
        <p className="text-cream/85">{t("password.lead")}</p>
      </div>
      <PasswordChange />
      <ButtonLink href="/ma-fiche" variant="ghost">
        {t("back")}
      </ButtonLink>
    </div>
  );
}
