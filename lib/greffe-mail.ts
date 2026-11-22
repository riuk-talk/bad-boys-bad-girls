import * as z from "zod/mini";

/**
 * The Messagerie du Greffe (10g): « Messagerie » in /admin, « Courrier du Greffe » for the member.
 * The database decides everything (greffe_* functions, RLS); these are the shapes it answers with
 * and the limits the screens check before sending.
 */

/** Characters of a message (greffe_send checks it again). */
export const BODY_MAX = 2000;
/** Images a message (greffe_send checks it again). */
export const FILES_MAX = 5;
/** Size of an image as chosen, before it is compressed in the browser. */
export const FILE_MAX_BYTES = 10 * 1024 * 1024;
/** The formats one may choose (HEIC: decoded by the browser where it can, Safari in practice). */
export const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
/** How long a signed URL of an image lives (private bucket). */
export const SIGNED_URL_SECONDS = 120;
/** The poses a member may deposit from their Courrier, and « juste pour montrer ». */
export const DEPOSIT_CHOICES = ["0", "1", "2", "show"] as const;
export type DepositChoice = (typeof DEPOSIT_CHOICES)[number];

const attachmentSchema = z.object({
  id: z.string(),
  path: z.string(),
  width: z.number(),
  height: z.number(),
  url: z.optional(z.nullable(z.string())),
});
export type Attachment = z.infer<typeof attachmentSchema>;

const proposalSchema = z.object({
  id: z.string(),
  position: z.number(),
  status: z.enum(["proposed", "accepted", "refused", "applied"]),
  path: z.nullable(z.string()),
  width: z.number(),
  height: z.number(),
  url: z.optional(z.nullable(z.string())),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const greffeMessageSchema = z.object({
  id: z.number(),
  side: z.enum(["team", "member"]),
  label: z.nullable(z.string()),
  body: z.nullable(z.string()),
  kind: z.enum(["text", "photo_deposit", "photo_proposal", "photo_accepted", "photo_refused"]),
  is_moderation: z.boolean(),
  pose: z.nullable(z.number()),
  created_at: z.string(),
  author_id: z.optional(z.nullable(z.string())),
  attachments: z.array(attachmentSchema),
  attachments_removed: z.number(),
  proposal: z.nullable(proposalSchema),
});
export type GreffeMessage = z.infer<typeof greffeMessageSchema>;

export const greffeUpdateSchema = z.object({
  archived_at: z.nullable(z.string()),
  member_read_id: z.number(),
  team_read_id: z.number(),
  messages: z.array(greffeMessageSchema),
});
export type GreffeUpdate = z.infer<typeof greffeUpdateSchema>;

export const memberThreadSchema = z.object({
  id: z.string(),
  archived_at: z.nullable(z.string()),
  member_read_id: z.number(),
  team_read_id: z.number(),
  messages: z.array(greffeMessageSchema),
});
export type MemberThread = z.infer<typeof memberThreadSchema>;

export const teamThreadSchema = z.object({
  id: z.string(),
  member_id: z.string(),
  pseudo: z.nullable(z.string()),
  role: z.nullable(z.enum(["bad", "visitor"])),
  gender: z.nullable(z.string()),
  member_state: z.string(),
  reachable: z.boolean(),
  archived_at: z.nullable(z.string()),
  member_read_id: z.number(),
  team_read_id: z.number(),
  messages: z.array(greffeMessageSchema),
});
export type TeamThread = z.infer<typeof teamThreadSchema>;

export type Side = "team" | "member";

/** New messages after the ones shown, without doubles, in order. */
export function mergeGreffe(
  current: readonly GreffeMessage[],
  incoming: readonly GreffeMessage[],
): GreffeMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * « Lu »: the last message of mine the other side has read (shown under it only), or none.
 * `otherReadId` is how far the other side read.
 */
export function readMark(
  messages: readonly GreffeMessage[],
  mine: Side,
  otherReadId: number,
): number | null {
  let mark: number | null = null;
  for (const message of messages) {
    if (message.side === mine && message.id <= otherReadId) mark = message.id;
  }
  return mark;
}

/** The newest message of the other side (what reading the thread marks). */
export function newestOf(messages: readonly GreffeMessage[], side: Side): number {
  let newest = 0;
  for (const message of messages)
    if (message.side === side && message.id > newest) newest = message.id;
  return newest;
}

/** The images a member or the team may send: at most 5, each under 10 MB, of a known format. */
export function checkFiles(
  files: readonly { size: number; type: string; name: string }[],
): "tooMany" | "tooBig" | "badType" | null {
  if (files.length > FILES_MAX) return "tooMany";
  for (const file of files) {
    if (file.size > FILE_MAX_BYTES) return "tooBig";
    const type = file.type.toLowerCase();
    const heicByName = type === "" && /\.(heic|heif)$/i.test(file.name);
    if (!FILE_TYPES.includes(type) && !heicByName) return "badType";
  }
  return null;
}

/** The error codes of the greffe_* functions, as the screens' message keys. */
export function greffeErrorKey(message: string | undefined): string {
  const code = message ?? "";
  for (const key of [
    "thread_closed",
    "member_unreachable",
    "message_too_long",
    "empty_message",
    "too_many_files",
    "invalid_file",
    "greffe_rate_limit",
    "already_decided",
    "invalid_position",
    "no_deposit",
    "report_limit",
  ]) {
    if (code.includes(key)) return key;
  }
  return "generic";
}
