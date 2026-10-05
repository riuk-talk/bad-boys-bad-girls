import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/user";
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

const REASONS = ["face_hidden", "not_alone", "sunglasses", "nudity", "contacts", "wrong_pose", "not_adult", "other"] as const;
const POSITION_KEYS: Record<number, "face" | "left" | "right"> = { 0: "face", 1: "left", 2: "right" };
const SIGNED_URL_SECONDS = 300;

/** Le Greffe, minimum (Phase 3): the photo queue, one decision per photo. Admins only. */
export default async function GreffePage({ searchParams }: Props) {
  const member = await requireMember();
  const { data: isAdmin } = await member.supabase.rpc("is_admin");
  if (isAdmin !== true) notFound();
  const t = await getTranslations("Greffe");
  const { error, done } = await searchParams;

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

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("lead")}</p>
        <p className="text-accent font-semibold" role="status">
          {t("waiting", { count: rows.length })}
        </p>
        {error === "notPending" || error === "generic" ? (
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
          const position = key ? t(`positions.${key}`) : t("positions.extra", { number: row.photo_position + 1 });
          const url = urlOf(row.pending_path);
          return (
            <li key={row.photo_id} className="border-line space-y-3 rounded-lg border bg-[#121214] p-3">
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
              <p className="font-semibold">
                {row.pseudo} · {t(`roles.${row.role}`)} · <span className="text-accent">{position}</span>
              </p>
              <form action={decidePhotoAction} className="space-y-2">
                <input type="hidden" name="photoId" value={row.photo_id} />
                <Button type="submit" name="decision" value="approve" className="w-full">
                  {t("approve")}
                </Button>
              </form>
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
                <Button type="submit" name="decision" value="reject" variant="danger" className="w-full">
                  {t("reject")}
                </Button>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
