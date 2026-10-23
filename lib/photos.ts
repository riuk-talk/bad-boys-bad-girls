import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const SIGNED_URL_SECONDS = 600;

export type PhotoInfo = {
  url: string | null;
  status: Database["public"]["Enums"]["moderation_status"];
  reason: string | null;
  /** Cut out in the browser: shown in front of the wall (2026-10-23, version B). */
  cutout: boolean;
};

/**
 * The member's own photos at these positions: a short-lived signed URL while pending (private
 * bucket, owner only), the public URL once validated by the Greffe, no URL when refused.
 */
export async function photoInfos(
  supabase: SupabaseClient<Database>,
  userId: string,
  positions: readonly number[],
): Promise<Record<number, PhotoInfo | null>> {
  const { data: photos } = await supabase
    .from("photos")
    .select("position, status, pending_path, public_path_large, rejection_reason, is_cutout")
    .eq("owner_id", userId)
    .in("position", positions);
  const result: Record<number, PhotoInfo | null> = Object.fromEntries(
    positions.map((p) => [p, null]),
  );
  const pending = (photos ?? []).filter(
    (photo) => photo.status === "pending" && photo.pending_path,
  );
  const { data: signed } = pending.length
    ? await supabase.storage.from("photos-pending").createSignedUrls(
        pending.map((photo) => photo.pending_path as string),
        SIGNED_URL_SECONDS,
      )
    : { data: [] };
  for (const photo of photos ?? []) {
    const url =
      photo.status === "approved" && photo.public_path_large
        ? supabase.storage.from("photos").getPublicUrl(photo.public_path_large).data.publicUrl
        : photo.status === "pending"
          ? (signed?.find((entry) => entry.path === photo.pending_path)?.signedUrl ?? null)
          : null;
    result[photo.position] = {
      url,
      status: photo.status,
      reason: photo.rejection_reason,
      cutout: photo.is_cutout,
    };
  }
  return result;
}
