import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NewPasswordForm } from "@/components/auth/auth-forms";
import { RecoverySecondFactor } from "@/components/auth/recovery-second-factor";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("newPasswordTitle") };
}

/**
 * Reached from the password-reset e-mail (session opened by /api/auth/confirm). An account with a
 * verified second factor (the super admin) is at aal1 after the link: Supabase Auth refuses the
 * new password until the TOTP code raises the session to aal2, so that step comes first.
 */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Auth");
  const factorId = await pendingSecondFactor();
  return (
    <>
      <h1 className="font-display text-4xl tracking-wide uppercase">{t("newPasswordTitle")}</h1>
      <p className="text-cream/85 mt-2 mb-8">{t("newPasswordLead")}</p>
      {factorId ? <RecoverySecondFactor factorId={factorId} /> : <NewPasswordForm />}
    </>
  );
}

/** The verified TOTP factor still to pass in this session, if any. */
async function pendingSecondFactor(): Promise<string | null> {
  const supabase = await createClient();
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!level || level.currentLevel !== "aal1" || level.nextLevel !== "aal2") return null;
  const { data: factors } = await supabase.auth.mfa.listFactors();
  return factors?.totp[0]?.id ?? null;
}
