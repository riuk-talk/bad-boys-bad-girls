import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CasierCheck } from "@/components/onboarding/casier";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { loadCliches } from "@/lib/casier-server";
import { caseNumberFromId } from "@/lib/case-number";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Onboarding.kickers" });
  return { title: t("casierCheck") };
}

export default async function MyCasierPreviewPage() {
  const member = await requireMember();
  const locale = await getLocale();
  const { data: casier } = await member.supabase
    .from("casier_charges")
    .select("charge_1, charge_2, charge_3, true_index")
    .eq("profile_id", member.userId)
    .maybeSingle();
  if (!casier) return redirect({ href: "/mon-casier", locale });
  const [t, cliches] = await Promise.all([
    getTranslations("Onboarding"),
    loadCliches(member.supabase),
  ]);
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="text-accent font-stamp text-center text-sm tracking-[0.25em] uppercase">
        {t("kickers.casierCheck")}
      </p>
      <h1 className="font-display mt-2 mb-6 text-center text-4xl tracking-wide uppercase">
        {t("steps.casierCheck")}
      </h1>
      <CasierCheck
        charges={[casier.charge_1, casier.charge_2, casier.charge_3]}
        trueIndex={casier.true_index}
        caseNumber={caseNumberFromId(member.userId)}
        reworkHref="/mon-casier"
        context="file"
        cliches={cliches}
      />
    </div>
  );
}
