"use server";

import * as z from "zod/mini";
import { uploadPhotoAction } from "@/app/[locale]/(app)/onboarding/actions";
import { requireMember } from "@/lib/auth/user";
import {
  BODY_MAX,
  FILES_MAX,
  greffeErrorKey,
  greffeUpdateSchema,
  type GreffeUpdate,
} from "@/lib/greffe-mail";
import { GREFFE_BUCKET, removeFiles, storeImages, withUrls } from "@/lib/greffe-mail-server";
import { withSmallSizes } from "@/lib/cleanup/files";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The Messagerie du Greffe (10g), for both sides: the team (/admin/messagerie) and the member
 * (Courrier du Greffe). Who may read and write what is decided by the database (greffe_* functions,
 * RLS of the tables and of the bucket); these actions check the shape of the input, store the
 * images with the secret key once the database said yes, and translate the error codes.
 */

const uuid = z
  .string()
  .check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));
const messageId = z.number().check(z.int(), z.minimum(0));

export type GreffeResult = { ok: true; id: number } | { ok: false; error: string };

/** The messages after the last one shown (a Realtime signal, the return to the tab, a poll). */
export async function loadGreffeAction(
  threadId: string,
  after: number,
): Promise<GreffeUpdate | null> {
  const id = uuid.safeParse(threadId);
  const from = messageId.safeParse(after);
  if (!id.success || !from.success) return null;
  const member = await requireMember();
  const { data, error } = await member.supabase.rpc("greffe_messages_since", {
    p_thread: id.data,
    p_after: from.data,
  });
  if (error) return null;
  const parsed = greffeUpdateSchema.safeParse(data);
  if (!parsed.success) return null;
  return { ...parsed.data, messages: await withUrls(member.supabase, parsed.data.messages) };
}

/** What is on screen is read (« Lu » on the other side). */
export async function markGreffeReadAction(threadId: string, upto: number): Promise<void> {
  const id = uuid.safeParse(threadId);
  const to = messageId.safeParse(upto);
  if (!id.success || !to.success || to.data === 0) return;
  const member = await requireMember();
  await member.supabase.rpc("greffe_mark_read", { p_thread: id.data, p_upto: to.data });
}

const sendSchema = z.object({
  thread: uuid,
  body: z.string().check(z.maxLength(BODY_MAX)),
  moderation: z.boolean(),
});

/**
 * A message: text and/or up to 5 images (compressed by the browser, re-encoded here, stored in
 * the private bucket). The images are stored only after greffe_write_target said yes; if the
 * message is refused, they are removed.
 */
export async function sendGreffeAction(form: FormData): Promise<GreffeResult> {
  const parsed = sendSchema.safeParse({
    thread: form.get("thread"),
    body: String(form.get("body") ?? ""),
    moderation: form.get("moderation") === "1",
  });
  if (!parsed.success) return { ok: false, error: "message_too_long" };
  const files = form
    .getAll("files")
    .filter((file): file is File => file instanceof File && file.size > 0);
  if (files.length > FILES_MAX) return { ok: false, error: "too_many_files" };
  const body = parsed.data.body.trim();
  if (body === "" && files.length === 0) return { ok: false, error: "empty_message" };

  const member = await requireMember();
  const { data: target, error: targetError } = await member.supabase.rpc("greffe_write_target", {
    p_thread: parsed.data.thread,
  });
  if (targetError || typeof target !== "string") {
    return { ok: false, error: greffeErrorKey(targetError?.message) };
  }
  const stored = files.length > 0 ? await storeImages(target, files) : [];
  if (!Array.isArray(stored))
    return { ok: false, error: stored === "generic" ? "generic" : "invalid_file" };
  const { data, error } = await member.supabase.rpc("greffe_send", {
    p_thread: parsed.data.thread,
    p_body: body.length > 0 ? body : undefined,
    p_attachments: stored,
    p_moderation: parsed.data.moderation,
  });
  if (error || typeof data !== "number") {
    await removeFiles(stored.map((file) => file.path));
    return { ok: false, error: greffeErrorKey(error?.message) };
  }
  return { ok: true, id: data };
}

const depositSchema = z.object({ pose: z.enum(["0", "1", "2"]) });

/**
 * A photo for a pose, sent from the Courrier: deposited at the Greffe like any photo of Ma fiche
 * (the same upload, the same queue), then said in the thread.
 */
export async function depositPoseAction(form: FormData): Promise<GreffeResult> {
  const parsed = depositSchema.safeParse({ pose: form.get("pose") });
  const file = form.get("photo");
  if (!parsed.success || !(file instanceof File) || file.size === 0) {
    return { ok: false, error: "generic" };
  }
  const upload = new FormData();
  upload.set("photo", file);
  upload.set("position", parsed.data.pose);
  const result = await uploadPhotoAction({ status: "idle" }, upload);
  if (result.status !== "done") return { ok: false, error: "photo_refused" };
  const member = await requireMember();
  const { data, error } = await member.supabase.rpc("greffe_note_deposit", {
    p_pose: Number(parsed.data.pose),
  });
  if (error || typeof data !== "number")
    return { ok: false, error: greffeErrorKey(error?.message) };
  return { ok: true, id: data };
}

const decideSchema = z.object({ proposal: uuid, accept: z.boolean() });

/**
 * « Accepter » / « Refuser » a photo proposed by the team: the member's own decision
 * (greffe_decide_photo_proposal). Accepted, the server copies it into the public bucket and the
 * database replaces the pose (greffe_apply_photo_proposal, which refuses anything not accepted by
 * the member); the replaced files and the private copy are then removed. Called again, it finishes
 * an acceptance left half-done.
 */
export async function decideProposalAction(
  proposalId: string,
  accept: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = decideSchema.safeParse({ proposal: proposalId, accept });
  if (!parsed.success) return { ok: false, error: "generic" };
  const member = await requireMember();
  const { data: before } = await member.supabase
    .from("greffe_photo_proposals")
    .select("id, status, path_large, path_small, member_id")
    .eq("id", parsed.data.proposal)
    .maybeSingle();
  if (!before || before.member_id !== member.userId) return { ok: false, error: "generic" };
  if (before.status === "proposed") {
    const { error } = await member.supabase.rpc("greffe_decide_photo_proposal", {
      p_proposal: before.id,
      p_accept: parsed.data.accept,
    });
    if (error) return { ok: false, error: greffeErrorKey(error.message) };
  } else if (!(before.status === "accepted" && parsed.data.accept)) {
    return { ok: false, error: "already_decided" };
  }
  const admin = createAdminClient();
  const privateFiles = [before.path_large, before.path_small];
  if (!parsed.data.accept) {
    await removeFiles(privateFiles);
    await admin.rpc("cleanup_greffe_files_done", { p_attachments: [], p_proposals: [before.id] });
    return { ok: true };
  }

  const name = crypto.randomUUID();
  const fresh = [`${name}.webp`, `${name}-s.webp`] as const;
  const copies = await Promise.all([
    admin.storage
      .from(GREFFE_BUCKET)
      .copy(before.path_large, fresh[0], { destinationBucket: "photos" }),
    admin.storage
      .from(GREFFE_BUCKET)
      .copy(before.path_small, fresh[1], { destinationBucket: "photos" }),
  ]);
  if (copies.some((copy) => copy.error)) {
    await admin.storage.from("photos").remove([...fresh]);
    return { ok: false, error: "generic" };
  }
  const { data: old, error } = await admin.rpc("greffe_apply_photo_proposal", {
    p_proposal: before.id,
    p_public_large: fresh[0],
    p_public_small: fresh[1],
  });
  if (error) {
    await admin.storage.from("photos").remove([...fresh]);
    return { ok: false, error: "generic" };
  }
  // The replaced photo's files, then the private copy of the proposal.
  const replaced = z
    .object({
      pending: z.nullable(z.string()),
      large: z.nullable(z.string()),
      small: z.nullable(z.string()),
    })
    .safeParse(old);
  if (replaced.success) {
    if (replaced.data.pending) {
      await admin.storage.from("photos-pending").remove(withSmallSizes([replaced.data.pending]));
    }
    const publicOld = [replaced.data.large, replaced.data.small].filter(
      (path): path is string => typeof path === "string",
    );
    if (publicOld.length > 0) await admin.storage.from("photos").remove(publicOld);
  }
  await removeFiles(privateFiles);
  await admin.rpc("cleanup_greffe_files_done", { p_attachments: [], p_proposals: [before.id] });
  return { ok: true };
}
