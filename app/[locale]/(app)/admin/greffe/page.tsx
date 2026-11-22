import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GreffeCutout } from "@/components/admin/greffe-cutout";
import { Mugshot } from "@/components/brand/mugshot";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { adminCan, requireAdminPermission } from "@/lib/admin/guard";
import { openThreadAction } from "../messagerie/actions";
import { photoBatchAllowed } from "@/lib/photo-batch";
import { createAdminClient } from "@/lib/supabase/admin";
import { decidePhotoAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Greffe" });
  return { title: t("title") };
}

const REASONS = [
  "face_hidden",
  "not_alone",
  "sunglasses",
  "nudity",
  "contacts",
  "wrong_pose",
  "not_adult",
  "other",
] as const;
/** « Valider sans détourage » (9k): internal motives, never shown to the member. */
const WAIVER_REASONS = ["failed_cutout", "atypical_photo", "other"] as const;
const POSITION_KEYS: Record<number, "face" | "left" | "right"> = {
  0: "face",
  1: "left",
  2: "right",
};
const SIGNED_URL_SECONDS = 300;

/** Le Greffe, minimum (Phase 3): the photo queue, one decision per photo. Admins only. */
export default async function GreffePage({ searchParams }: Props) {
  const member = await requireAdminPermission("greffe.decide");
  const t = await getTranslations("Greffe");
  const { error, done } = await searchParams;
  // « Écrire au membre » (10g), for a role that opens the Messagerie.
  const canWrite = await adminCan(member, "members.message");

  const { data: queue } = await member.supabase.rpc("admin_photo_queue", { p_limit: 60 });
  const rows = queue ?? [];
  // Pending files are private to their owner: short-lived signed URLs with the secret key.
  const { data: signed } = rows.length
    ? await createAdminClient()
        .storage.from("photos-pending")
        .createSignedUrls(
          rows.map((row) => row.pending_path),
          SIGNED_URL_SECONDS,
        )
    : { data: [] };
  const urlOf = (path: string) => signed?.find((entry) => entry.path === path)?.signedUrl ?? null;
  // Shown as the members will see it: cut out on the wall, or with the graduations (2026-10-23).
  const { data: cutouts } = rows.length
    ? await member.supabase.rpc("admin_photo_cutouts", { p_ids: rows.map((row) => row.photo_id) })
    : { data: [] };
  const cut = new Set((cutouts ?? []).filter((c) => c.is_cutout).map((c) => c.photo_id));
  // Not cut out by the member's device: the Greffe cuts it out before validating (2026-10-23).
  const { data: toCut } = rows.length
    ? await member.supabase.rpc("admin_photos_to_cut_out", {
        p_ids: rows.map((row) => row.photo_id),
      })
    : { data: [] };
  const waiting = new Set(toCut ?? []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("lead")}</p>
        <p className="text-accent font-semibold" role="status">
          {t("waiting", { count: rows.length })}
        </p>
        {photoBatchAllowed(process.env.NEXT_PUBLIC_SUPABASE_URL) ? (
          <p>
            <Link href="/admin/greffe/lot" className="text-accent underline underline-offset-4">
              {t("batch.link")}
            </Link>
          </p>
        ) : null}
        {error === "notPending" ||
        error === "needsCutout" ||
        error === "waiveReason" ||
        error === "generic" ? (
          <p role="alert" className="text-red-bright font-medium">
            {t(`errors.${error}`)}
          </p>
        ) : done ? (
          <p role="status" className="text-green-bright font-medium">
            {t("done")}
          </p>
        ) : null}
      </div>
      {rows.length === 0 ? <p className="text-grey">{t("empty")}</p> : null}
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => {
          const key = POSITION_KEYS[row.photo_position];
          const position = key
            ? t(`positions.${key}`)
            : t("positions.extra", { number: row.photo_position + 1 });
          const url = urlOf(row.pending_path);
          return (
            <li
              key={row.photo_id}
              className="border-line space-y-3 rounded-lg border bg-[#121214] p-3"
            >
              {url && key ? (
                <Mugshot
                  src={url}
                  alt={t("photoAlt", { position, pseudo: row.pseudo ?? "" })}
                  cutout={cut.has(row.photo_id)}
                  className="aspect-[3/4] rounded-sm"
                />
              ) : (
                <div className="toise-wall aspect-[3/4] overflow-hidden rounded-sm">
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private file
                    <img
                      src={url}
                      alt={t("photoAlt", { position, pseudo: row.pseudo ?? "" })}
                      className="size-full object-contain"
                    />
                  ) : null}
                </div>
              )}
              <p className="text-grey text-xs" data-testid="cutout-state">
                {key
                  ? cut.has(row.photo_id)
                    ? t("cutout")
                    : waiting.has(row.photo_id)
                      ? t("needsCutout")
                      : t("asIs")
                  : null}
              </p>
              <p className="font-semibold">
                {row.pseudo} · {t(`roles.${row.role}`)} ·{" "}
                <span className="text-accent">{position}</span>
              </p>
              {waiting.has(row.photo_id) && url ? (
                <GreffeCutout
                  photoId={row.photo_id}
                  src={url}
                  alt={t("photoAlt", { position, pseudo: row.pseudo ?? "" })}
                />
              ) : (
                <form action={decidePhotoAction} className="space-y-2">
                  <input type="hidden" name="photoId" value={row.photo_id} />
                  <Button type="submit" name="decision" value="approve" className="w-full">
                    {t("approve")}
                  </Button>
                </form>
              )}
              {/* A pose not cut out: cutting it out stays the default (first); validating it
                  without cut-out is shown right under it, with a required internal motive (9k). */}
              {key && !cut.has(row.photo_id) ? (
                <section
                  aria-labelledby={`waive-title-${row.photo_id}`}
                  className="border-line rounded-lg border px-3 py-2"
                  data-testid="waive"
                >
                  <h2
                    id={`waive-title-${row.photo_id}`}
                    className="min-h-11 content-center text-sm font-semibold"
                  >
                    {t("waive.summary")}
                  </h2>
                  <form action={decidePhotoAction} className="space-y-2">
                    <input type="hidden" name="photoId" value={row.photo_id} />
                    <p className="text-cream/85 text-sm">{t("waive.lead")}</p>
                    <label className="block text-sm" htmlFor={`waive-${row.photo_id}`}>
                      {t("waive.reasonLabel")}
                    </label>
                    <select
                      id={`waive-${row.photo_id}`}
                      name="waiveReason"
                      required
                      defaultValue=""
                      className="border-line bg-ink-2 min-h-11 w-full rounded-lg border px-3"
                    >
                      <option value="" disabled>
                        {t("waive.choose")}
                      </option>
                      {WAIVER_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {t(`waive.reasons.${reason}`)}
                        </option>
                      ))}
                    </select>
                    <label className="block text-sm" htmlFor={`waive-detail-${row.photo_id}`}>
                      {t("waive.detailLabel")}
                    </label>
                    <input
                      id={`waive-detail-${row.photo_id}`}
                      name="waiveDetail"
                      maxLength={200}
                      className="border-line bg-ink-2 min-h-11 w-full rounded-lg border px-3"
                    />
                    <Button
                      type="submit"
                      name="decision"
                      value="approve_waived"
                      variant="secondary"
                      className="w-full"
                    >
                      {t("waive.submit")}
                    </Button>
                  </form>
                </section>
              ) : null}
              <form action={decidePhotoAction} className="space-y-2">
                <input type="hidden" name="photoId" value={row.photo_id} />
                <label className="block text-sm" htmlFor={`reason-${row.photo_id}`}>
                  {t("reasonLabel")}
                </label>
                <select
                  id={`reason-${row.photo_id}`}
                  name="reason"
                  required
                  className="border-line bg-ink-2 min-h-11 w-full rounded-lg border px-3"
                >
                  {REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {t(`reasons.${reason}`)}
                    </option>
                  ))}
                </select>
                <Button
                  type="submit"
                  name="decision"
                  value="reject"
                  variant="danger"
                  className="w-full"
                >
                  {t("reject")}
                </Button>
              </form>
              {canWrite ? (
                <form action={openThreadAction}>
                  <input type="hidden" name="member" value={row.owner_id} />
                  <Button type="submit" variant="secondary" className="w-full">
                    {t("writeToMember")}
                  </Button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
