import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

/** A pending photo is stored in two sizes: name.webp and name-s.webp (Greffe, Phase 3). */
export function withSmallSizes(paths: readonly string[]): string[] {
  return [
    ...new Set(
      paths.flatMap((path) =>
        path.endsWith("-s.webp") ? [path] : [path, path.replace(/\.webp$/, "-s.webp")],
      ),
    ),
  ];
}

/**
 * Every file of a member: the pending ones (their own folder, listed too in case a row is
 * missing) and the public ones. Returns false if one removal failed (the account is then kept for
 * the next run, so no file is left behind without its owner).
 */
export async function removeMemberFiles(
  admin: Admin,
  userId: string,
  pendingPaths: readonly string[],
  publicPaths: readonly string[],
): Promise<boolean> {
  const { data: listed, error: listError } = await admin.storage
    .from("photos-pending")
    .list(userId, { limit: 1000 });
  if (listError) return false;
  const pending = withSmallSizes([
    ...pendingPaths,
    ...(listed ?? []).map((file) => `${userId}/${file.name}`),
  ]);
  if (pending.length > 0) {
    const { error } = await admin.storage.from("photos-pending").remove(pending);
    if (error) return false;
  }
  if (publicPaths.length > 0) {
    const { error } = await admin.storage.from("photos").remove([...publicPaths]);
    if (error) return false;
  }
  // The images and proposed photos of the Courrier du Greffe (10g), under the member's folder.
  const { data: mail, error: mailError } = await admin.storage
    .from("greffe-mail")
    .list(userId, { limit: 1000 });
  if (mailError) return false;
  if ((mail ?? []).length > 0) {
    const { error } = await admin.storage
      .from("greffe-mail")
      .remove((mail ?? []).map((file) => `${userId}/${file.name}`));
    if (error) return false;
  }
  return true;
}

/**
 * The files of the Messagerie due for removal (10g: 30 days after the archiving of a thread,
 * 12 months at most, a proposal once decided): removed, then marked so in the database.
 */
export async function removeGreffeFilesDue(admin: Admin, limit: number): Promise<number> {
  const { data: due, error } = await admin.rpc("cleanup_greffe_files_due", { p_limit: limit });
  if (error || !due || due.length === 0) return 0;
  const { error: removeError } = await admin.storage
    .from("greffe-mail")
    .remove(due.flatMap((row) => row.paths));
  if (removeError) return 0;
  const { error: doneError } = await admin.rpc("cleanup_greffe_files_done", {
    p_attachments: due.filter((row) => row.kind === "attachment").map((row) => row.id),
    p_proposals: due.filter((row) => row.kind === "proposal").map((row) => row.id),
  });
  return doneError ? 0 : due.length;
}

/**
 * New random names for a public photo (SPEC §11: after 30 days of pause, at a ban): both sizes
 * are copied, the database records the new names, then the old files are removed.
 */
export async function rotatePublicPhoto(
  admin: Admin,
  photo: { photo_id: string; public_path_large: string; public_path_small: string },
): Promise<boolean> {
  const name = crypto.randomUUID();
  const fresh = [`${name}.webp`, `${name}-s.webp`] as const;
  const old = [photo.public_path_large, photo.public_path_small] as const;
  const copies = await Promise.all([
    admin.storage.from("photos").copy(old[0], fresh[0]),
    admin.storage.from("photos").copy(old[1], fresh[1]),
  ]);
  if (copies.some((copy) => copy.error)) {
    await admin.storage.from("photos").remove([...fresh]);
    return false;
  }
  const { data: recorded, error } = await admin.rpc("cleanup_photo_rotated", {
    p_photo: photo.photo_id,
    p_old_large: photo.public_path_large,
    p_new_large: fresh[0],
    p_new_small: fresh[1],
  });
  if (error || recorded !== true) {
    await admin.storage.from("photos").remove([...fresh]);
    return false;
  }
  await admin.storage.from("photos").remove([...old]);
  return true;
}
