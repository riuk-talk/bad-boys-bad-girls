"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import * as z from "zod/mini";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { PhotoError, processPhoto } from "@/lib/image/process";
import { photoBatchAllowed } from "@/lib/photo-batch";
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

/** « Valider sans détourage » (9k): the internal motives; « other » needs a short text. */
const WAIVER_REASONS = ["failed_cutout", "atypical_photo", "other"] as const;

const decisionSchema = z.object({
  photoId: z.uuid(),
  decision: z.enum(["approve", "reject", "approve_waived"]),
  reason: z.optional(z.enum(REASONS)),
  waiveReason: z.optional(z.enum(WAIVER_REASONS)),
  waiveDetail: z.optional(z.string().check(z.trim(), z.maxLength(200))),
});

async function back(
  error?: "notPending" | "needsCutout" | "waiveReason" | "generic",
): Promise<never> {
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
    waiveReason: form.get("waiveReason") || undefined,
    waiveDetail: form.get("waiveDetail") || undefined,
  });
  if (!parsed.success) {
    return back(form.get("decision") === "approve_waived" ? "waiveReason" : "generic");
  }
  const { photoId, decision, reason, waiveReason, waiveDetail } = parsed.data;
  // Without cut-out: a motive, and its text for « other » (checked again by SQL).
  if (
    decision === "approve_waived" &&
    (!waiveReason || (waiveReason === "other" && !waiveDetail))
  ) {
    return back("waiveReason");
  }
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
  // « Valider sans détourage » (9k): the waiver (admin only, logged) and the validation in one
  // SQL transaction; otherwise the usual validation.
  const { error } =
    decision === "approve_waived"
      ? await member.supabase.rpc("admin_approve_without_cutout", {
          p_photo: photoId,
          p_reason: waiveReason!,
          p_detail: waiveDetail ?? "",
          p_public_large: published[0]!,
          p_public_small: published[1]!,
        })
      : await member.supabase.rpc("admin_decide_photo", {
          p_photo: photoId,
          p_approve: true,
          p_public_large: published[0],
          p_public_small: published[1],
        });
  if (error) {
    await admin.storage.from("photos").remove(published);
    if (error.message.includes("photo_not_pending")) return back("notPending");
    if (error.message.includes("invalid_reason")) return back("waiveReason");
    // photos_cutout_or_waived: a pose neither cut out nor waived is never validated as it is.
    if (error.code === "23514") return back("needsCutout");
    return back("generic");
  }
  await admin.storage.from("photos-pending").remove(pending);
  return back();
}

export type CutoutState = { status: "done" } | { status: "error"; message: CutoutError };
type CutoutError = "notCutout" | "notWaiting" | "notAllowed" | "generic";

const cutoutSchema = z.object({ photoId: z.uuid(), photo: z.file() });

/** The admin, second factor checked by SQL; then the cut-out file, checked by the server. */
async function cutoutInput(form: FormData) {
  const parsed = cutoutSchema.safeParse({ photoId: form.get("photoId"), photo: form.get("photo") });
  if (!parsed.success || parsed.data.photo.size === 0) return null;
  const member = await requireMember();
  const { data: isAdmin } = await member.supabase.rpc("is_admin");
  if (isAdmin !== true) return null;
  let processed: Awaited<ReturnType<typeof processPhoto>>;
  try {
    processed = await processPhoto(Buffer.from(await parsed.data.photo.arrayBuffer()), {
      keepCutout: true,
    });
  } catch (error) {
    if (error instanceof PhotoError)
      return { member, photoId: parsed.data.photoId, processed: null };
    throw error;
  }
  return { member, photoId: parsed.data.photoId, processed };
}

const fileOptions = { contentType: "image/webp", cacheControl: "31536000", upsert: false };

/**
 * The Greffe cuts out a pending photo that the member's device could not cut out (owner's final
 * decision 2026-10-23), in the admin's browser with the same tool. The server checks the file is
 * really cut out, stores it in the owner's folder, records it (SQL, admin only), then removes the
 * previous files. The photo can then be validated.
 */
export async function storeGreffeCutoutAction(form: FormData): Promise<CutoutState> {
  const input = await cutoutInput(form);
  if (!input) return { status: "error", message: "generic" };
  if (!input.processed?.cutout) return { status: "error", message: "notCutout" };
  const admin = createAdminClient();
  const { data: photo } = await admin
    .from("photos")
    .select("owner_id, status, needs_cutout")
    .eq("id", input.photoId)
    .maybeSingle();
  if (!photo || photo.status !== "pending" || !photo.needs_cutout) {
    return { status: "error", message: "notWaiting" };
  }
  const base = `${photo.owner_id}/${crypto.randomUUID()}`;
  const fresh = [`${base}.webp`, `${base}-s.webp`];
  const bucket = admin.storage.from("photos-pending");
  const uploads = await Promise.all([
    bucket.upload(fresh[0]!, input.processed.large, fileOptions),
    bucket.upload(fresh[1]!, input.processed.small, fileOptions),
  ]);
  if (uploads.some((upload) => upload.error)) {
    await bucket.remove(fresh);
    return { status: "error", message: "generic" };
  }
  const { data: previous, error } = await input.member.supabase.rpc("admin_store_cutout", {
    p_photo: input.photoId,
    p_pending_path: fresh[0]!,
  });
  if (error) {
    await bucket.remove(fresh);
    return {
      status: "error",
      message: error.message.includes("photo_not_waiting_cutout") ? "notWaiting" : "generic",
    };
  }
  if (previous) await bucket.remove([previous, smallPath(previous)]);
  revalidatePath("/[locale]/admin/greffe", "page");
  return { status: "done" };
}

/**
 * Preview only (owner's final decision 2026-10-23): a photo validated before the decision is
 * replaced by its cut-out, made in the admin's browser. Refused unless the site is wired to the
 * preview base (lib/photo-batch) and the base allows it (app_settings.photo_batch_allowed).
 */
export async function replaceWithCutoutAction(form: FormData): Promise<CutoutState> {
  if (!photoBatchAllowed(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    return { status: "error", message: "notAllowed" };
  }
  const input = await cutoutInput(form);
  if (!input) return { status: "error", message: "generic" };
  if (!input.processed?.cutout) return { status: "error", message: "notCutout" };
  const admin = createAdminClient();
  const name = crypto.randomUUID();
  const fresh = [`${name}.webp`, `${name}-s.webp`];
  const bucket = admin.storage.from("photos");
  const uploads = await Promise.all([
    bucket.upload(fresh[0]!, input.processed.large, fileOptions),
    bucket.upload(fresh[1]!, input.processed.small, fileOptions),
  ]);
  if (uploads.some((upload) => upload.error)) {
    await bucket.remove(fresh);
    return { status: "error", message: "generic" };
  }
  const { data: previous, error } = await input.member.supabase.rpc("admin_replace_public_photo", {
    p_photo: input.photoId,
    p_large: fresh[0]!,
    p_small: fresh[1]!,
  });
  if (error) {
    await bucket.remove(fresh);
    return {
      status: "error",
      message: error.message.includes("batch_not_allowed")
        ? "notAllowed"
        : error.message.includes("photo_not_in_batch")
          ? "notWaiting"
          : "generic",
    };
  }
  const old = previous?.[0];
  if (old)
    await bucket.remove([old.old_large, old.old_small].filter((path): path is string => !!path));
  // No revalidation: the batch page keeps its list (each item shows its state) until reloaded.
  return { status: "done" };
}
