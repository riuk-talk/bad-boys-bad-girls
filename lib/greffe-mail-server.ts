import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SIGNED_URL_SECONDS, type GreffeMessage } from "@/lib/greffe-mail";
import { PhotoError, processAttachment } from "@/lib/image/process";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export const GREFFE_BUCKET = "greffe-mail";

/**
 * Short-lived signed URLs of the images of these messages, made with the reader's own session:
 * the bucket's policy (private.can_read_greffe_file) lets only the thread's readers sign them.
 */
export async function withUrls(
  supabase: SupabaseClient<Database>,
  messages: readonly GreffeMessage[],
): Promise<GreffeMessage[]> {
  const paths = messages.flatMap((message) => [
    ...message.attachments.map((file) => file.path),
    ...(message.proposal?.path ? [message.proposal.path] : []),
  ]);
  if (paths.length === 0) return [...messages];
  const { data } = await supabase.storage
    .from(GREFFE_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_SECONDS);
  const url = (path: string | null) =>
    path ? (data?.find((entry) => entry.path === path)?.signedUrl ?? null) : null;
  return messages.map((message) => ({
    ...message,
    attachments: message.attachments.map((file) => ({ ...file, url: url(file.path) })),
    proposal: message.proposal ? { ...message.proposal, url: url(message.proposal.path) } : null,
  }));
}

export type StoredFile = { path: string; width: number; height: number };

/**
 * The images of a message, re-encoded on the server (no metadata) and stored under the member's
 * folder of the private bucket with the secret key, once the database said the caller may write
 * in this thread (greffe_write_target). On any failure, what was stored is removed.
 */
export async function storeImages(
  memberId: string,
  files: readonly File[],
): Promise<StoredFile[] | "unreadable" | "tooBig" | "generic"> {
  const admin = createAdminClient();
  const stored: StoredFile[] = [];
  for (const file of files) {
    let processed: Awaited<ReturnType<typeof processAttachment>>;
    try {
      processed = await processAttachment(Buffer.from(await file.arrayBuffer()));
    } catch (error) {
      await removeFiles(stored.map((entry) => entry.path));
      if (error instanceof PhotoError && error.reason === "unreadable") return "unreadable";
      return "tooBig";
    }
    const path = `${memberId}/${crypto.randomUUID()}.webp`;
    const { error } = await admin.storage
      .from(GREFFE_BUCKET)
      .upload(path, processed.image, { contentType: "image/webp", upsert: false });
    if (error) {
      await removeFiles(stored.map((entry) => entry.path));
      return "generic";
    }
    stored.push({ path, width: processed.width, height: processed.height });
  }
  return stored;
}

export async function removeFiles(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  await createAdminClient()
    .storage.from(GREFFE_BUCKET)
    .remove([...paths]);
}
