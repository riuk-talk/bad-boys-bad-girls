import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { FicheCard } from "@/components/brand/fiche-card";
import { PermitCard } from "@/components/brand/permit-card";
import { FicheEditor } from "@/components/fiche/fiche-editor";
import { PhotoManager } from "@/components/fiche/photo-manager";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { ageFromBirthdate, completeness } from "@/lib/fiche/completeness";
import { parseRole } from "@/lib/onboarding/config";

type Props = { params: Promise<{ locale: string }> };
type Label = { fr?: string; en?: string };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "MyFiche" });
  return { title: t("titleShort") };
}

const SIGNED_URL_SECONDS = 600;

export default async function MyFichePage() {
  const member = await requireMember();
  const locale = (await getLocale()) as "fr" | "en";
  const t = await getTranslations("MyFiche");
  const { supabase, userId } = member;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.onboarding_completed_at) return redirect({ href: "/onboarding", locale });
  // Same page for both roles: the Bad's Fiche (Dossier) or the Visitor's Permis de visite.
  const role = parseRole(profile.role) ?? "bad";
  const isVisitor = role === "visitor";

  const [{ data: place }, { data: photos }, { data: tribes }, { data: mine }] = await Promise.all([
    supabase
      .from("places")
      .select("name")
      .eq("id", profile.place_id ?? 0)
      .maybeSingle(),
    supabase
      .from("photos")
      .select("id, position, status, pending_path, rejection_reason")
      .eq("owner_id", userId)
      .order("position"),
    supabase.from("tribes").select("id, label").order("sort"),
    supabase.from("profile_tribes").select("tribe_id, detail").eq("profile_id", userId),
  ]);

  // Photos awaiting validation are private: short-lived signed URLs, owner only (storage RLS).
  const paths = (photos ?? []).flatMap((photo) =>
    photo.pending_path
      ? [photo.pending_path, photo.pending_path.replace(/\.webp$/, "-s.webp")]
      : [],
  );
  const { data: signed } = paths.length
    ? await supabase.storage.from("photos-pending").createSignedUrls(paths, SIGNED_URL_SECONDS)
    : { data: [] };
  const urlFor = (path: string | null) =>
    signed?.find((entry) => entry.path === path)?.signedUrl ?? null;

  const labelOf = (label: unknown) =>
    ((label as Label)[locale] ?? (label as Label).fr ?? "") as string;
  const tribeLabels = new Map((tribes ?? []).map((tribe) => [tribe.id, labelOf(tribe.label)]));
  const selected = Object.fromEntries((mine ?? []).map((row) => [row.tribe_id, row.detail]));
  // A Permis shows one photo; an ex-Bad's other photos stay in reserve (SPEC v7 §5 bis).
  const shownPhotos = (photos ?? []).filter((photo) => !isVisitor || photo.position === 0);
  const main = shownPhotos.find((photo) => photo.position === 0);
  const mainUrl = urlFor(main?.pending_path ?? null);
  const gauge = completeness({
    mainPhoto: main ? main.status : "missing",
    photoCount: photos?.length ?? 0,
    bioLength: profile.bio?.length ?? 0,
    signCount: mine?.length ?? 0,
  });
  const statusKey = main ? main.status : "missing";
  const signs = (mine ?? []).map((row) => {
    const label = tribeLabels.get(row.tribe_id) ?? "";
    return row.detail ? `${label} — ${row.detail}` : label;
  });
  const photo = mainUrl && main ? { src: mainUrl, width: 960, height: 1200 } : null;
  const age = profile.birthdate ? ageFromBirthdate(profile.birthdate) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-4xl tracking-wide uppercase sm:text-5xl">
        {t(`title_${role}`)}
      </h1>

      <p
        role="status"
        className={
          statusKey === "approved"
            ? "border-gold/60 bg-gold/10 text-gold rounded-lg border px-4 py-3"
            : "border-line bg-ink-2 rounded-lg border px-4 py-3"
        }
      >
        {t(`status_${role}.${statusKey}`, { reason: main?.rejection_reason ?? "" })}
      </p>

      {isVisitor ? null : (
        <section aria-labelledby="gauge-title" className="space-y-3">
          <h2 id="gauge-title" className="font-display text-2xl tracking-wide uppercase">
            {t("gaugeLabel", { percent: gauge.percent })}
          </h2>
          <div
            role="progressbar"
            aria-labelledby="gauge-title"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={gauge.percent}
            className="bg-ink-3 h-3 overflow-hidden rounded-full"
          >
            <div className="bg-gold h-full rounded-full" style={{ width: `${gauge.percent}%` }} />
          </div>
          <p className="text-grey">{t("gaugeHint")}</p>
          {gauge.missing.length > 0 ? (
            <ul className="text-cream/85 list-inside list-disc">
              {gauge.missing.map((key) => (
                <li key={key}>{t(`criteria.${key}`)}</li>
              ))}
            </ul>
          ) : null}
        </section>
      )}

      <section aria-labelledby="preview-title" className="space-y-4">
        <h2 id="preview-title" className="font-display text-2xl tracking-wide uppercase">
          {t("previewTitle")}
        </h2>
        {isVisitor ? (
          <PermitCard
            className="max-w-md"
            data={{
              id: profile.id,
              pseudo: profile.pseudo ?? "",
              age,
              city: place?.name ?? "",
              photo,
              motive: profile.visit_motive ?? "",
              signs,
              delivered: main?.status === "approved",
              // No report or visit exists before Phases 4–5: the record is clean, no visit yet.
              cleanRecord: true,
              visits: null,
            }}
          />
        ) : (
          <FicheCard
            className="max-w-sm lg:max-w-none"
            data={{
              id: profile.id,
              pseudo: profile.pseudo ?? "",
              age,
              city: place?.name ?? "",
              photo,
              signs,
              charges: [],
              bio: profile.bio,
              goodConduct: profile.is_reglo,
            }}
          />
        )}
      </section>

      <section aria-labelledby="photos-title" className="space-y-3">
        <h2 id="photos-title" className="font-display text-2xl tracking-wide uppercase">
          {t(`photosTitle_${role}`)}
        </h2>
        <p className="text-grey">{t(`photosHint_${role}`)}</p>
        <PhotoManager
          single={isVisitor}
          photos={shownPhotos.map((photo) => ({
            id: photo.id,
            position: photo.position,
            status: photo.status,
            url:
              urlFor(
                photo.pending_path ? photo.pending_path.replace(/\.webp$/, "-s.webp") : null,
              ) ?? urlFor(photo.pending_path),
          }))}
        />
      </section>

      <section aria-labelledby="edit-title" className="space-y-4">
        <h2 id="edit-title" className="font-display text-2xl tracking-wide uppercase">
          {t(`editTitle_${role}`)}
        </h2>
        <FicheEditor
          role={role}
          text={(isVisitor ? profile.visit_motive : profile.bio) ?? ""}
          tribes={(tribes ?? []).map((tribe) => ({ id: tribe.id, label: labelOf(tribe.label) }))}
          selected={selected}
        />
      </section>
    </div>
  );
}
