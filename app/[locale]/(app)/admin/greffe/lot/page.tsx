import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { PhotoBatch } from "@/components/admin/greffe-cutout";
import { requireAdminPermission } from "@/lib/admin/guard";
import { photoBatchAllowed } from "@/lib/photo-batch";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Greffe.batch" });
  return { title: t("title") };
}

const POSITION_KEYS: Record<number, "face" | "left" | "right"> = {
  0: "face",
  1: "left",
  2: "right",
};

/**
 * Preview only (owner's final decision 2026-10-23): the batch cut-out of the photos validated
 * before the decision. Not found unless the site is wired to the preview base and the base allows
 * it (app_settings.photo_batch_allowed, checked by SQL with the admin's second factor).
 */
export default async function PhotoBatchPage() {
  if (!photoBatchAllowed(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const member = await requireAdminPermission("greffe.decide");
  const { data: rows, error } = await member.supabase.rpc("admin_photo_batch", { p_limit: 30 });
  if (error) notFound();
  const t = await getTranslations("Greffe");
  const items = (rows ?? []).map((row) => {
    const key = POSITION_KEYS[row.photo_position] ?? "face";
    return {
      photoId: row.photo_id,
      src: member.supabase.storage.from("photos").getPublicUrl(row.public_path_large).data
        .publicUrl,
      alt: `${row.pseudo} · ${t(`roles.${row.role}`)} · ${t(`positions.${key}`)}`,
    };
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("batch.title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("batch.lead")}</p>
        <p className="text-accent font-semibold" role="status">
          {t("batch.count", { count: items.length })}
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-grey">{t("batch.empty")}</p>
      ) : (
        <PhotoBatch items={items} />
      )}
    </div>
  );
}
