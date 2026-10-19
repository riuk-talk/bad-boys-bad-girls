import * as z from "zod/mini";

/**
 * Le Parloir (Phase 5c): the shape of a visit and of its messages as the SQL functions return
 * them (get_visit, get_messages), and the screen each state leads to. Every rule (presence, the
 * 30 minutes, absence at +10 min, the 24 h to choose, the secret choices) lives in Postgres; this
 * module only reads the state.
 */

const gender = z.enum(["man", "woman", "non_binary", "other"]);

export const visitSchema = z.object({
  id: z.string(),
  request_id: z.string(),
  status: z.enum(["scheduled", "in_progress", "ended", "cancelled", "no_show"]),
  starts_at: z.string(),
  ends_at: z.string(),
  now: z.string(),
  cabin: z.number(),
  i_am_bad: z.boolean(),
  other: z.object({
    id: z.string(),
    pseudo: z.string(),
    gender: z.nullable(gender),
    photo_small: z.nullable(z.string()),
  }),
  me_present: z.boolean(),
  other_present: z.boolean(),
  absent: z.nullable(z.enum(["me", "other", "both"])),
  visitor_clean_record: z.boolean(),
  visitor_honored: z.number(),
  visitor_due: z.number(),
  end_choice_deadline: z.nullable(z.string()),
  my_choice: z.nullable(z.enum(["prolong", "close"])),
  outcome: z.nullable(z.enum(["released", "closed"])),
  conversation_id: z.nullable(z.string()),
  conversation_status: z.nullable(z.enum(["visiting", "open", "closed"])),
  request_status: z.string(),
  can_propose: z.boolean(),
});
export type Visit = z.infer<typeof visitSchema>;

const betPayload = z.object({
  type: z.literal("bet"),
  charge: z.nullable(z.string()),
  correct: z.boolean(),
  true_charge: z.nullable(z.string()),
});
const notePayload = z.object({ type: z.literal("note"), text: z.string() });
const markPayload = z.object({ type: z.enum(["released", "closed"]) });
export const payloadSchema = z.union([betPayload, notePayload, markPayload]);
export type Payload = z.infer<typeof payloadSchema>;

export const messageSchema = z.object({
  id: z.number(),
  kind: z.enum(["text", "system"]),
  mine: z.boolean(),
  body: z.nullable(z.string()),
  payload: z.nullable(payloadSchema),
  created_at: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

export const conversationSchema = z.object({
  id: z.string(),
  request_id: z.string(),
  status: z.enum(["visiting", "open", "closed"]),
  released_at: z.nullable(z.string()),
  i_am_bad: z.boolean(),
  other: z.object({
    id: z.string(),
    pseudo: z.string(),
    gender: z.nullable(gender),
    photo_small: z.nullable(z.string()),
  }),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const readStateSchema = z.object({ my_read_id: z.number(), other_read_id: z.number() });

/** « Lu » goes under my last message, once the other has read up to it (SPEC §13, owner 2026-10-19). */
export function readMarkFor(messages: readonly Message[], otherReadId: number): number | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message && message.kind === "text" && message.mine) {
      return otherReadId >= message.id ? message.id : null;
    }
  }
  return null;
}

/** The unread messages of all my Parloirs sans horaire, for the « Visites » tab. */
export function totalUnread(rows: readonly { unread: number }[]): number {
  return rows.reduce((sum, row) => sum + Math.max(0, row.unread), 0);
}

/** The screen of a visit. */
export type VisitPhase =
  | "before" // scheduled, not started yet
  | "waiting" // in progress, the other one is not there yet
  | "live" // both present, the 30 minutes
  | "absent" // marked absent 10 minutes after the start
  | "choose" // ended, my choice to make
  | "chosen" // ended, waiting for the other (or the deadline)
  | "released" // Permis permanent
  | "closed" // affaire classée
  | "cancelled";

export function visitPhase(visit: Visit, now: number): VisitPhase {
  if (visit.outcome === "released") return "released";
  if (visit.outcome === "closed") return "closed";
  switch (visit.status) {
    case "cancelled":
      return "cancelled";
    case "no_show":
      return "absent";
    case "ended":
      return visit.my_choice === null ? "choose" : "chosen";
    case "in_progress":
      if (now >= Date.parse(visit.ends_at)) return "live";
      return visit.me_present && visit.other_present ? "live" : "waiting";
    default:
      return now >= Date.parse(visit.starts_at) ? "waiting" : "before";
  }
}

/** « 24:12 »: minutes and seconds left, never negative; hours shown beyond 60 minutes. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** The difference between the database clock and the device clock, so countdowns follow the base. */
export function clockOffset(serverNow: string, deviceNow: number): number {
  return Date.parse(serverNow) - deviceNow;
}

/** « CABINE 03 ». */
export function cabinLabel(cabin: number): string {
  return String(cabin).padStart(2, "0");
}

/** Messages merged by id, in order (a poll and a realtime event may bring the same one). */
export function mergeMessages(
  current: readonly Message[],
  incoming: readonly Message[],
): Message[] {
  const byId = new Map<number, Message>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export const MESSAGE_MAX = 1000;
