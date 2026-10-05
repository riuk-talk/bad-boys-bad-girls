"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import * as z from "zod/mini";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { createAdminClient } from "@/lib/supabase/admin";

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

const decisionSchema = z.object({
  photoId: z.uuid(),
  decision: z.enum(["approve", "reject"]),
  reason: z.optional(z.enum(REASONS)),
});

async function back(error?: "notPending" | "generic"): Promise<never> {
  revalidatePath("/[locale]/admin/greffe", "page");
  return redirect({
    href: error ? `/admin/greffe?error=${error}` : "/admin/greffe?done=1",
    locale: await getLocale(),
  });
}

const smallPath = (path: string) => path.replace(/\.webp$/, "-s.webp");

/**
 * Le Greffe (SPEC §11, PARCOURS-DESIGN §3): one decision per photo. The decision is recorded by
 * SQL as the admin (is_admin() checked there, then the owner is notified); the files are moved
 * with the secret key: validated → copied to the public bucket under a random name; in every case
 * the pending files are deleted once the decision is recorded.
 */
export async function decidePhotoAction(form: FormData): Promise<void> {
  const parsed = decisionSchema.safeParse({
    photoId: form.get("photoId"),
    decision: form.get("decision"),
    reason: form.get("reason") || undefined,
  });
  if (!parsed.success) return back("generic");
  const { photoId, decision, reason } = parsed.data;
  const member = await requireMember();
  const { data: isAdmin } = await member.supabase.rpc("is_admin");
  if (isAdmin !== true) return back("generic");

  const admin = createAdminClient();
  const { data: photo } = await admin
    .from("photos")
    .select("pending_path, status")
    .eq("id", photoId)
    .maybeSingle();
  if (!photo || photo.status !== "pending" || !photo.pending_path) return back("notPending");
  const pending = [photo.pending_path, smallPath(photo.pending_path)];

  if (decision === "reject") {
    if (!reason) return back("generic");
    const { error } = await member.supabase.rpc("admin_decide_photo", {
      p_photo: photoId,
      p_approve: false,
      p_reason: reason,
    });
    if (error) return back(error.message.includes("photo_not_pending") ? "notPending" : "generic");
    await admin.storage.from("photos-pending").remove(pending);
    return back();
  }

  // Approval: copy both sizes to the public bucket under a new random name (never the owner id).
  const name = crypto.randomUUID();
  const published = [`${name}.webp`, `${name}-s.webp`];
  const files = await Promise.all(
    pending.map((path) => admin.storage.from("photos-pending").download(path)),
  );
  if (files.some((file) => file.error || !file.data)) return back("generic");
  const uploads = await Promise.all(
    files.map((file, index) =>
      admin.storage.from("photos").upload(published[index]!, file.data!, {
        contentType: "image/webp",
        cacheControl: "31536000",
        upsert: false,
      }),
    ),
  );
  if (uploads.some((upload) => upload.error)) {
    await admin.storage.from("photos").remove(published);
    return back("generic");
  }
  const { error } = await member.supabase.rpc("admin_decide_photo", {
    p_photo: photoId,
    p_approve: true,
    p_public_large: published[0],
    p_public_small: published[1],
  });
  if (error) {
    await admin.storage.from("photos").remove(published);
    return back(error.message.includes("photo_not_pending") ? "notPending" : "generic");
  }
  await admin.storage.from("photos-pending").remove(pending);
  return back();
}
