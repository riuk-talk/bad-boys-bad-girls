"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import * as z from "zod/mini";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { greffeErrorKey } from "@/lib/greffe-mail";
import { GREFFE_BUCKET, removeFiles } from "@/lib/greffe-mail-server";
import { PhotoError, processPhoto } from "@/lib/image/process";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Messagerie (10g), the team's side. Every function asks members.message and the second factor
 * again (has_admin_permission); the outcome comes back in the address (?error=…, ?done=1).
 */

const uuid = z
  .string()
  .check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));

async function go(href: string): Promise<never> {
  return redirect({ href, locale: await getLocale() });
}

/** « Écrire »: the member's thread, created or reopened, then opened. */
export async function openThreadAction(form: FormData): Promise<void> {
  const parsed = uuid.safeParse(form.get("member"));
  if (!parsed.success) return go("/admin/messagerie?error=not_found");
  const member = await requireMember();
  const { data, error } = await member.supabase.rpc("admin_messagerie_open", {
    p_member: parsed.data,
  });
  if (error || typeof data !== "string") return go("/admin/messagerie?error=not_found");
  revalidatePath("/[locale]/admin", "layout");
  return go(`/admin/messagerie/${data}`);
}

/** « Nouveau fil » from the list: a pseudo or N° d'écrou matching exactly one member. */
export async function newThreadAction(form: FormData): Promise<void> {
  const q = z
    .string()
    .check(z.trim(), z.minLength(2), z.maxLength(254))
    .safeParse(form.get("query"));
  if (!q.success) return go("/admin/messagerie?error=not_found");
  const member = await requireMember();
  const { data } = await member.supabase.rpc("admin_search_members", { p_query: q.data });
  const exact = (data ?? []).filter(
    (row) => row.pseudo?.toLowerCase() === q.data.toLowerCase() || (data ?? []).length === 1,
  );
  if (exact.length !== 1) return go("/admin/messagerie?error=not_found");
  const { data: thread, error } = await member.supabase.rpc("admin_messagerie_open", {
    p_member: exact[0]!.user_id,
  });
  if (error || typeof thread !== "string") return go("/admin/messagerie?error=not_found");
  return go(`/admin/messagerie/${thread}`);
}

export async function archiveThreadAction(form: FormData): Promise<void> {
  const parsed = z
    .object({ thread: uuid, archived: z.enum(["1", "0"]) })
    .safeParse({ thread: form.get("thread"), archived: form.get("archived") });
  if (!parsed.success) return go("/admin/messagerie?error=not_found");
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_messagerie_archive", {
    p_thread: parsed.data.thread,
    p_archived: parsed.data.archived === "1",
  });
  revalidatePath("/[locale]/admin", "layout");
  return go(`/admin/messagerie/${parsed.data.thread}${error ? "?error=generic" : "?done=1"}`);
}

/** The name the person signs with (« Le Greffe · Sam »), or none. */
export async function teamNameAction(form: FormData): Promise<void> {
  const parsed = z
    .string()
    .check(z.trim(), z.maxLength(30))
    .safeParse(form.get("name") ?? "");
  if (!parsed.success) return go("/admin/messagerie?error=team_name");
  const member = await requireMember();
  const { error } = await member.supabase.rpc("greffe_set_team_name", { p_name: parsed.data });
  return go(error ? "/admin/messagerie?error=team_name" : "/admin/messagerie?done=1");
}

export type ProposeState = { status: "idle" | "done" } | { status: "error"; message: string };

const proposeSchema = z.object({
  thread: uuid,
  position: z.enum(["0", "1", "2"]),
  body: z.string().check(z.maxLength(2000)),
});

/**
 * « Proposer une photo retouchée » for a pose: re-encoded like any photo (no metadata; its
 * transparency kept when it is cut out), stored in the member's folder of the private bucket, then
 * shown to the member with « Accepter » / « Refuser ». Cut out or not is the server's finding.
 */
export async function proposePhotoAction(
  _state: ProposeState,
  form: FormData,
): Promise<ProposeState> {
  const parsed = proposeSchema.safeParse({
    thread: form.get("thread"),
    position: form.get("position"),
    body: String(form.get("body") ?? ""),
  });
  const file = form.get("photo");
  if (!parsed.success || !(file instanceof File) || file.size === 0) {
    return { status: "error", message: "photoRequired" };
  }
  const member = await requireMember();
  const { data: target, error: targetError } = await member.supabase.rpc("greffe_write_target", {
    p_thread: parsed.data.thread,
  });
  if (targetError || typeof target !== "string") {
    return { status: "error", message: greffeErrorKey(targetError?.message) };
  }
  let processed: Awaited<ReturnType<typeof processPhoto>>;
  try {
    processed = await processPhoto(Buffer.from(await file.arrayBuffer()), { keepCutout: true });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof PhotoError ? `photo_${error.reason}` : "photo_unreadable",
    };
  }
  const admin = createAdminClient();
  const base = `${target}/proposal-${crypto.randomUUID()}`;
  const paths = [`${base}.webp`, `${base}-s.webp`] as const;
  const options = { contentType: "image/webp", upsert: false };
  const uploads = await Promise.all([
    admin.storage.from(GREFFE_BUCKET).upload(paths[0], processed.large, options),
    admin.storage.from(GREFFE_BUCKET).upload(paths[1], processed.small, options),
  ]);
  if (uploads.some((upload) => upload.error)) {
    await removeFiles(paths);
    return { status: "error", message: "generic" };
  }
  const body = parsed.data.body.trim();
  const { data: proposal, error } = await member.supabase.rpc("greffe_propose_photo", {
    p_thread: parsed.data.thread,
    p_position: Number(parsed.data.position),
    p_large: paths[0],
    p_small: paths[1],
    p_width: processed.width,
    p_height: processed.height,
    p_body: body.length > 0 ? body : undefined,
  });
  if (error || typeof proposal !== "string") {
    await removeFiles(paths);
    return { status: "error", message: greffeErrorKey(error?.message) };
  }
  if (processed.cutout) {
    await admin.from("greffe_photo_proposals").update({ is_cutout: true }).eq("id", proposal);
  }
  return { status: "done" };
}
