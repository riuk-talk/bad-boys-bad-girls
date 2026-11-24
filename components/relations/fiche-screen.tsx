import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { CloseDossier, DossierOverlay } from "@/components/relations/dossier-overlay";
import { FicheShow } from "@/components/relations/fiche-show";
import { SafetyActions } from "@/components/relations/safety-actions";
import { type PrompterInput, sharedTribeLabels } from "@/lib/prompter";
import { accentForGender } from "@/lib/accent";
import { ficheAction } from "@/lib/relations/fiche-action";
import { loadFiche, publicPhotoUrl, requireRole } from "@/lib/relations/server";
import { localize, type Label } from "@/lib/relations/types";
import { SITE_TIME_ZONE } from "@/lib/time-zone";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A Bad's Fiche (PARCOURS-DESIGN §2), on its own page (/fiche/[id]) or opened as a folder over
 * the Découverte (`dossier`, the intercepted route of the same URL). Unknown, hidden or blocked:
 * the same 404, never a hint. The Bad can open their own Fiche to see it as Visitors do.
 */
export async function FicheScreen({ id, dossier = false }: { id: string; dossier?: boolean }) {
  if (!UUID.test(id)) notFound();
  const { supabase, userId, locale, role, profile } = await requireRole();
  const fiche = await loadFiche(supabase, id);
  if (!fiche) notFound();
  const isSelf = userId === fiche.id;

  const photoUrls: Record<number, { url: string; cutout: boolean; waived: boolean } | null> = {};
  for (const photo of fiche.photos) {
    const url = publicPhotoUrl(supabase, photo.large);
    photoUrls[photo.position] = url
      ? { url, cutout: photo.cutout === true, waived: photo.waived === true }
      : null;
  }

  const pageT = await getTranslations("Relations.fichePage");
  let permitDelivered = false;
  let souffleur: PrompterInput | null = null;
  if (!isSelf && role === "visitor") {
    const [{ data: face }, { data: myTribes }] = await Promise.all([
      supabase
        .from("photos")
        .select("status")
        .eq("owner_id", userId)
        .eq("position", 0)
        .eq("status", "approved")
        .maybeSingle(),
      supabase.from("profile_tribes").select("tribes(label)").eq("profile_id", userId),
      supabase.rpc("mark_promenade_seen", { p_bad: fiche.id }),
    ]);
    permitDelivered = face?.status === "approved";
    const mine = (myTribes ?? []).flatMap((row) => {
      const tribe = row.tribes as { label: Label } | null;
      return tribe ? [{ label: tribe.label }] : [];
    });
    souffleur = {
      commonPoints: fiche.common_points.map((point) => ({
        question: localize(point.question, locale),
        answer: localize(point.answer, locale),
      })),
      // A complicity score exists only from 5 common questions (SPEC §9).
      commonCount: fiche.complicity !== null ? 5 : 0,
      sharedTribes: sharedTribeLabels(mine, fiche.tribes, locale),
    };
  }
  const action = ficheAction({
    isSelf,
    role,
    requestStatus: fiche.my_request_status,
    cooldownUntil: fiche.cooldown_until,
    requestsOpen: fiche.requests_open,
    permitDelivered,
    now: new Date(),
  });
  const status =
    action.kind === "self"
      ? pageT("selfPreview")
      : action.kind === "sent"
        ? pageT("pending")
        : action.kind === "accepted"
          ? pageT("accepted")
          : action.kind === "released"
            ? pageT("released")
            : action.kind === "cooldown"
              ? pageT("cooldown", {
                  date: new Intl.DateTimeFormat(locale, {
                    timeZone: SITE_TIME_ZONE,
                    day: "numeric",
                    month: "long",
                  }).format(action.until),
                })
              : action.kind === "permit"
                ? pageT("permitPending")
                : null;

  const screen = (
    <FicheShow
      fiche={fiche}
      photos={photoUrls}
      action={action}
      souffleur={souffleur}
      status={status}
      fullscreen={dossier}
      viewerAccent={accentForGender(profile.gender)}
      back={
        dossier ? (
          <CloseDossier />
        ) : (
          <LocalizedLink
            href={isSelf ? "/ma-fiche" : "/promenade"}
            className="text-cream hover:text-accent inline-flex min-h-11 items-center gap-1 px-2 text-sm font-semibold"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {isSelf ? pageT("backToMyFiche") : pageT("back")}
          </LocalizedLink>
        )
      }
      safety={
        isSelf ? null : (
          <SafetyActions
            memberId={fiche.id}
            pseudo={fiche.pseudo}
            reportType="profile"
            reportTarget={fiche.id}
            afterBlock={role === "bad" ? "/courrier" : "/promenade"}
          />
        )
      }
    />
  );
  if (!dossier) return <div className="mx-auto w-full max-w-3xl">{screen}</div>;
  const line = [
    fiche.age !== null ? pageT("years", { age: fiche.age }) : null,
    fiche.city,
    fiche.distance_km !== null ? pageT("km", { km: fiche.distance_km }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <DossierOverlay
      label={pageT("dossierOf", { pseudo: fiche.pseudo })}
      cover={{ pseudo: fiche.pseudo, line, ecrou: fiche.ecrou ?? "—", gender: fiche.gender }}
    >
      {screen}
    </DossierOverlay>
  );
}
