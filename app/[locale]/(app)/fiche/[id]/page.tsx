import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { Dossier } from "@/components/relations/dossier";
import { RequestModal } from "@/components/relations/request-modal";
import { SafetyActions } from "@/components/relations/safety-actions";
import { accentForGender } from "@/lib/accent";
import { sharedTribeLabels } from "@/lib/prompter";
import { loadFiche, publicPhotoUrl, requireRole } from "@/lib/relations/server";
import { localize, type Label } from "@/lib/relations/types";

type Props = { params: Promise<{ locale: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Relations.dossier" });
  return { title: t("metaTitle") };
}

/**
 * A Bad's Fiche (PARCOURS-DESIGN §2). Unknown, hidden or blocked: the same 404, never a hint.
 * The Bad can open their own Fiche here to see it as Visitors do.
 */
export default async function FichePage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, userId, locale, role } = await requireRole();
  const fiche = await loadFiche(supabase, id);
  if (!fiche) notFound();
  const t = await getTranslations("Relations.fichePage");
  const isSelf = userId === fiche.id;

  const photoUrls: Record<number, { url: string; cutout: boolean } | null> = {};
  for (const photo of fiche.photos) {
    const url = publicPhotoUrl(supabase, photo.large);
    photoUrls[photo.position] = url ? { url, cutout: photo.cutout === true } : null;
  }

  let action: ReactNode = null;
  if (isSelf) {
    action = <p className="text-grey text-center text-sm">{t("selfPreview")}</p>;
  } else if (role === "visitor") {
    const [{ data: face }, { data: myTribes }] = await Promise.all([
      supabase
        .from("photos")
        .select("status")
        .eq("owner_id", userId)
        .eq("position", 0)
        .maybeSingle(),
      supabase.from("profile_tribes").select("tribes(label)").eq("profile_id", userId),
      supabase.rpc("mark_promenade_seen", { p_bad: fiche.id }),
    ]);
    const cooldown = fiche.cooldown_until ? new Date(fiche.cooldown_until) : null;
    const statusLine = (text: string) => (
      <p
        role="status"
        className="border-line text-cream/90 rounded-md border px-4 py-3 text-center font-semibold"
      >
        {text}
      </p>
    );
    if (fiche.my_request_status === "pending") action = statusLine(t("pending"));
    else if (fiche.my_request_status === "accepted") action = statusLine(t("accepted"));
    else if (fiche.my_request_status === "released") action = statusLine(t("released"));
    else if (cooldown && cooldown > new Date()) {
      action = statusLine(
        t("cooldown", {
          date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(cooldown),
        }),
      );
    } else if (!fiche.requests_open) action = statusLine(t("full"));
    else if (face?.status !== "approved") action = statusLine(t("permitPending"));
    else {
      const mine = (myTribes ?? []).flatMap((row) => {
        const tribe = row.tribes as { label: Label } | null;
        return tribe ? [{ label: tribe.label }] : [];
      });
      action = (
        <RequestModal
          badId={fiche.id}
          accent={accentForGender(fiche.gender)}
          pseudo={fiche.pseudo}
          charges={fiche.charges}
          souffleur={{
            commonPoints: fiche.common_points.map((point) => ({
              question: localize(point.question, locale),
              answer: localize(point.answer, locale),
            })),
            // A complicity score exists only from 5 common questions (SPEC §9).
            commonCount: fiche.complicity !== null ? 5 : 0,
            sharedTribes: sharedTribeLabels(mine, fiche.tribes, locale),
          }}
        />
      );
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-2 px-2.5 py-2 sm:px-6 sm:py-4">
      <LocalizedLink
        href={isSelf ? "/ma-fiche" : "/promenade"}
        className="text-cream hover:text-accent inline-flex min-h-11 items-center gap-1 self-start px-2 text-sm font-semibold"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        {isSelf ? t("backToMyFiche") : t("back")}
      </LocalizedLink>
      <Dossier fiche={fiche} photos={photoUrls} />
      {!isSelf ? (
        <SafetyActions
          memberId={fiche.id}
          pseudo={fiche.pseudo}
          reportType="profile"
          reportTarget={fiche.id}
          afterBlock={role === "bad" ? "/courrier" : "/promenade"}
        />
      ) : null}
      {action ? (
        <div className="border-line bg-ink sticky bottom-14 z-20 -mx-2.5 border-t px-5 py-3.5 sm:mx-0 sm:rounded-md sm:border">
          {action}
        </div>
      ) : null}
    </div>
  );
}
