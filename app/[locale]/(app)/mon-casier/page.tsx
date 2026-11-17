import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CasierStepForm } from "@/components/onboarding/casier";
import { redirect } from "@/i18n/navigation";
import { requireMemberArea } from "@/lib/auth/user";
import { loadCliches } from "@/lib/casier-server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Onboarding.kickers" });
  return { title: t("casier") };
}

/** A Bad edits their Casier after the onboarding (same assistant, then « Teste ton Casier »). */
export default async function MyCasierPage() {
  const member = await requireMemberArea();
  const locale = await getLocale();
  const { data: profile } = await member.supabase
    .from("profiles")
    .select("role, onboarding_completed_at")
    .eq("id", member.userId)
    .maybeSingle();
  if (!profile?.onboarding_completed_at) return redirect({ href: "/onboarding", locale });
  if (profile.role !== "bad") return redirect({ href: "/ma-fiche", locale });
  const { data: casier } = await member.supabase
    .from("casier_charges")
    .select("charge_1, charge_2, charge_3, true_index")
    .eq("profile_id", member.userId)
    .maybeSingle();
  const charges = casier ? [casier.charge_1, casier.charge_2, casier.charge_3] : null;
  const initial: [string, string, string] =
    casier && charges
      ? [
          charges[casier.true_index - 1] ?? "",
          ...(charges.filter((_, index) => index !== casier.true_index - 1) as [string, string]),
        ]
      : ["", "", ""];
  const [t, cliches] = await Promise.all([
    getTranslations("Onboarding"),
    loadCliches(member.supabase),
  ]);
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="text-accent font-stamp text-center text-sm tracking-[0.25em] uppercase">
        {t("kickers.casier")}
      </p>
      <h1 className="font-display mt-2 mb-6 text-center text-4xl tracking-wide uppercase">
        {t("steps.casier")}
      </h1>
      <CasierStepForm initial={initial} context="file" cliches={cliches} />
    </div>
  );
}
