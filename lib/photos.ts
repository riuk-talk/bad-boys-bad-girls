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

type OwnPhoto = {
  id: string;
  status: Database["public"]["Enums"]["moderation_status"];
  pending_path: string | null;
  public_path_large: string | null;
  public_path_small: string | null;
};

export type OwnPhotoUrls = { large: string | null; small: string | null };

/**
 * The URLs of the member's own photos, by photo id (10e): the public files once the Greffe has
 * validated a photo (its pending files are deleted then), short-lived signed URLs of the private
 * files while it waits, nothing for a refused one. Large for the preview, small for the lists.
 */
export async function ownPhotoUrls(
  supabase: SupabaseClient<Database>,
  photos: readonly OwnPhoto[],
): Promise<Record<string, OwnPhotoUrls>> {
  const small = (path: string) => path.replace(/\.webp$/, "-s.webp");
  const pending = photos.filter((photo) => photo.status === "pending" && photo.pending_path);
  const paths = pending.flatMap((photo) => [photo.pending_path!, small(photo.pending_path!)]);
  const { data: signed } = paths.length
    ? await supabase.storage.from("photos-pending").createSignedUrls(paths, SIGNED_URL_SECONDS)
    : { data: [] };
  const signedUrl = (path: string) =>
    signed?.find((entry) => entry.path === path)?.signedUrl ?? null;
  const publicUrl = (path: string | null) =>
    path ? supabase.storage.from("photos").getPublicUrl(path).data.publicUrl : null;
  return Object.fromEntries(
    photos.map((photo) => {
      if (photo.status === "approved") {
        const large = publicUrl(photo.public_path_large);
        return [photo.id, { large, small: publicUrl(photo.public_path_small) ?? large }];
      }
      if (photo.status === "pending" && photo.pending_path) {
        const large = signedUrl(photo.pending_path);
        return [photo.id, { large, small: signedUrl(small(photo.pending_path)) ?? large }];
      }
      return [photo.id, { large: null, small: null }];
    }),
  );
}
