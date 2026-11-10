import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  BirthdateSection,
  GenderForm,
  PlaceForm,
  PseudoForm,
  type CorrectionView,
} from "@/components/fiche/identity-forms";
import { ButtonLink } from "@/components/ui/button-link";
import { requireRole } from "@/lib/relations/server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "MyFiche.identity" });
  return { title: t("title") };
}

/**
 * « Mon identité » (10e): what was given at sign-up, reviewed and changed. Pseudo (once every 30
 * days), gender, town (the quartier follows, a closed one is said before saving); the date of birth
 * only through a request to the Greffe. The rules are in Postgres.
 */
export default async function IdentityPage() {
  const { supabase, userId } = await requireRole();
  const t = await getTranslations("MyFiche.identity");
  const [{ data: profile }, { data: nextChange }, { data: corrections }] = await Promise.all([
    supabase
      .from("profiles")
      .select("pseudo, gender, birthdate, place_id")
      .eq("id", userId)
      .maybeSingle(),
    supabase.rpc("pseudo_next_change"),
    supabase
      .from("birthdate_corrections")
      .select("status, requested_birthdate, created_at, decision_reason")
      .order("created_at", { ascending: false })
      .limit(5),
    // The decision of the Greffe has been seen once this page is opened.
    supabase.rpc("mark_notifications_read", { p_types: ["birthdate_correction"] }),
  ]);
  const { data: place } = profile?.place_id
    ? await supabase
        .from("places")
        .select("id, name, postal_codes")
        .eq("id", profile.place_id)
        .maybeSingle()
    : { data: null };

  const views: CorrectionView[] = (corrections ?? []).map((c) => ({
    status: c.status as CorrectionView["status"],
    requested: c.requested_birthdate,
    createdAt: c.created_at,
    decisionReason: c.decision_reason,
  }));

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85">{t("lead")}</p>
      </div>
      <PseudoForm pseudo={profile?.pseudo ?? ""} nextChange={nextChange ?? null} />
      <GenderForm gender={profile?.gender ?? null} />
      <PlaceForm
        place={
          place ? { id: place.id, label: `${place.name} (${place.postal_codes[0] ?? ""})` } : null
        }
      />
      {profile?.birthdate ? (
        <BirthdateSection birthdate={profile.birthdate} corrections={views} />
      ) : null}
      <ButtonLink href="/ma-fiche" variant="ghost">
        {t("back")}
      </ButtonLink>
    </div>
  );
}
