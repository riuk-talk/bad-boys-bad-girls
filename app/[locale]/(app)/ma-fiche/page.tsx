import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { FicheCard } from "@/components/brand/fiche-card";
import { PermitCard } from "@/components/brand/permit-card";
import { FicheEditor } from "@/components/fiche/fiche-editor";
import { PhotoManager } from "@/components/fiche/photo-manager";
import { Notices, type Notice } from "@/components/fiche/notices";
import { PosesEditor } from "@/components/onboarding/poses";
import { PushSettings } from "@/components/push/push-settings";
import { AccountSettings } from "@/components/relations/account-settings";
import { ButtonLink } from "@/components/ui/button-link";
import { photoInfos } from "@/lib/photos";
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

  const [
    { data: place },
    { data: photos },
    { data: tribes },
    { data: mine },
    { data: casier },
    { count: answered },
    { count: questionCount },
    { data: notices },
    { data: blocked },
    { data: prefs },
    { data: devices },
  ] = await Promise.all([
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
    supabase
      .from("casier_charges")
      .select("charge_1, charge_2, charge_3")
      .eq("profile_id", userId)
      .maybeSingle(),
    supabase
      .from("answers")
      .select("question_id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase.from("questions").select("id", { count: "exact", head: true }),
    supabase
      .from("notifications")
      .select("id, type, payload, created_at")
      .in("type", ["moderation_decision", "permit_granted"])
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.rpc("get_my_blocks"),
    supabase
      .from("notification_preferences")
      .select("push_requests, push_promenade, push_visits")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.rpc("push_device_count"),
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
  // A Bad's Fiche is validated once the 3 poses are (PARCOURS-DESIGN §3).
  const poses = [0, 1, 2].map((position) => photos?.find((p) => p.position === position));
  const statusKey = isVisitor
    ? main
      ? main.status
      : "missing"
    : poses.some((pose) => !pose)
      ? "missing"
      : poses.some((pose) => pose?.status === "rejected")
        ? "rejected"
        : poses.every((pose) => pose?.status === "approved")
          ? "approved"
          : "pending";
  const signs = (mine ?? []).map((row) => {
    const label = tribeLabels.get(row.tribe_id) ?? "";
    return row.detail ? `${label} — ${row.detail}` : label;
  });
  const photo = mainUrl && main ? { src: mainUrl, width: 960, height: 1200 } : null;
  // Décisions du Greffe (Phase 7a): the outcome of my reports and the decisions about me.
  const { count: unreadDecisions } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .in("type", ["sanction", "report_decided"])
    .is("read_at", null);
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
            ? "border-accent/60 bg-accent/10 text-accent rounded-lg border px-4 py-3"
            : "border-line bg-ink-2 rounded-lg border px-4 py-3"
        }
      >
        {t(`status_${role}.${statusKey}`, { reason: main?.rejection_reason ?? "" })}
      </p>

      <Notices notices={(notices ?? []) as Notice[]} />

      <nav aria-label={t("shortcutsLabel")} className="flex flex-wrap gap-3">
        <ButtonLink href="/interrogatoire" variant="secondary">
          {t("interrogationLink", { answered: answered ?? 0, total: questionCount ?? 0 })}
        </ButtonLink>
        {isVisitor ? null : (
          <ButtonLink href="/mon-casier" variant="secondary">
            {t("casierLink")}
          </ButtonLink>
        )}
        {isVisitor || statusKey !== "approved" ? null : (
          <ButtonLink href={`/fiche/${profile.id}`} variant="secondary">
            {t("seeAsVisitors")}
          </ButtonLink>
        )}
        <ButtonLink href="/ma-fiche/donnees" variant="secondary">
          {t("myDataLink")}
        </ButtonLink>
        <ButtonLink href="/ma-fiche/decisions" variant="secondary">
          {t("decisionsLink", { count: unreadDecisions ?? 0 })}
        </ButtonLink>
      </nav>

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
            <div className="bg-accent h-full rounded-full" style={{ width: `${gauge.percent}%` }} />
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
              charges: casier ? [casier.charge_1, casier.charge_2, casier.charge_3] : [],
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
        {isVisitor ? null : <PosesEditor photos={await photoInfos(supabase, userId, [0, 1, 2])} />}
        {isVisitor ? null : <h3 className="font-semibold">{t("extraPhotos")}</h3>}
        <PhotoManager
          single={isVisitor}
          positions={isVisitor ? [0] : [3, 4, 5]}
          photos={shownPhotos
            .filter((photo) => isVisitor || photo.position >= 3)
            .map((photo) => ({
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

      <section aria-labelledby="notifications-title" className="space-y-4">
        <h2 id="notifications-title" className="font-display text-2xl tracking-wide uppercase">
          {t("notificationsTitle")}
        </h2>
        <PushSettings
          devices={devices ?? 0}
          preferences={{
            requests: prefs?.push_requests ?? true,
            promenade: prefs?.push_promenade ?? true,
            visits: prefs?.push_visits ?? true,
          }}
        />
      </section>

      <section aria-labelledby="account-title" className="space-y-4">
        <h2 id="account-title" className="font-display text-2xl tracking-wide uppercase">
          {t("accountTitle")}
        </h2>
        <AccountSettings
          role={role}
          paused={profile.is_paused}
          nextRoleChange={
            profile.role_changed_at
              ? new Date(
                  new Date(profile.role_changed_at).getTime() + 7 * 24 * 3600 * 1000,
                ).toISOString()
              : null
          }
          hasMotive={Boolean(profile.visit_motive)}
          blocked={(blocked ?? []).map((row) => ({ id: row.blocked_id, pseudo: row.pseudo }))}
          locale={locale}
        />
      </section>
    </div>
  );
}
