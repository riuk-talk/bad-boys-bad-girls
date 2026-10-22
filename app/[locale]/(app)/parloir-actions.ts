"use server";

import * as z from "zod/mini";
import { requireMember } from "@/lib/auth/user";
import {
  MESSAGE_MAX,
  messageSchema,
  readStateSchema,
  visitSchema,
  type Message,
  type Visit,
} from "@/lib/parloir";
import { requestErrorKey } from "@/lib/relations/server";
import type { ActionState } from "./relations-actions";

/**
 * Le Parloir (Phase 5c). Presence, the 30 minutes, absences, the secret end choices, masking and
 * the 30 messages per minute are all checked by the SQL functions; these actions validate the
 * shape of the input and translate the error codes.
 */

const uuid = z
  .string()
  .check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));

type VisitResult = { visit: Visit } | { error: string };

/** Opening or refreshing the visit screen: the member is present (join_visit, database clock). */
export async function syncVisitAction(visitId: string): Promise<VisitResult> {
  const id = uuid.safeParse(visitId);
  if (!id.success) return { error: "not_found" };
  const member = await requireMember();
  const { data, error } = await member.supabase.rpc("join_visit", { p_visit: id.data });
  if (error) return { error: requestErrorKey(error.message) };
  const parsed = visitSchema.safeParse(data);
  return parsed.success ? { visit: parsed.data } : { error: "generic" };
}

/** The messages after the last one shown (a poll, or a realtime signal), and how far the other read. */
export async function loadMessagesAction(
  conversationId: string,
  after: number,
): Promise<{ messages: Message[]; otherReadId: number } | null> {
  const id = uuid.safeParse(conversationId);
  const from = z.number().check(z.int(), z.gte(0)).safeParse(after);
  if (!id.success || !from.success) return null;
  const member = await requireMember();
  const [messages, read] = await Promise.all([
    member.supabase.rpc("get_messages", { p_conversation: id.data, p_after: from.data }),
    member.supabase.rpc("get_read_state", { p_conversation: id.data }),
  ]);
  if (messages.error || !messages.data) return null;
  const parsed = z.array(messageSchema).safeParse(messages.data);
  const state = readStateSchema.safeParse(read.data);
  if (!parsed.success) return null;
  return { messages: parsed.data, otherReadId: state.success ? state.data.other_read_id : 0 };
}

/** The member has seen the conversation up to this message (Lu / non-lus, Phase 6a). */
export async function markReadAction(conversationId: string, upTo: number): Promise<void> {
  const id = uuid.safeParse(conversationId);
  const to = z.number().check(z.int(), z.gte(0)).safeParse(upTo);
  if (!id.success || !to.success) return;
  const member = await requireMember();
  await member.supabase.rpc("mark_conversation_read", {
    p_conversation: id.data,
    p_up_to: to.data,
  });
}

/** The relance « Toujours là ? » was shown: it will not come back in this conversation. */
export async function ackNudgeAction(conversationId: string): Promise<void> {
  const id = uuid.safeParse(conversationId);
  if (!id.success) return;
  const member = await requireMember();
  await member.supabase.rpc("ack_parloir_nudge", { p_conversation: id.data });
}

const messageInput = z.object({
  conversation: uuid,
  body: z.string().check(z.minLength(1), z.maxLength(MESSAGE_MAX)),
});

export async function sendMessageAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = messageInput.safeParse({
    conversation: form.get("conversation"),
    body: String(form.get("body") ?? "").trim(),
  });
  if (!parsed.success) return { status: "error", message: "message_empty" };
  const member = await requireMember();
  const { error } = await member.supabase.rpc("send_message", {
    p_conversation: parsed.data.conversation,
    p_body: parsed.data.body,
  });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return { status: "done" };
}

const endInput = z.object({ visit: uuid, choice: z.enum(["prolong", "close"]) });

/** « Prolonger » or « Affaire classée », once; the other's choice is never returned. */
export async function chooseEndAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = endInput.safeParse({ visit: form.get("visit"), choice: form.get("choice") });
  if (!parsed.success) return { status: "error", message: "choice_required" };
  const member = await requireMember();
  const { error } = await member.supabase.rpc("choose_visit_end", {
    p_visit: parsed.data.visit,
    p_prolong: parsed.data.choice === "prolong",
  });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return { status: "done" };
}

/** « Affaire classée » from the Parloir sans horaire. */
export async function closeConversationAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = uuid.safeParse(form.get("conversation"));
  if (!parsed.success) return { status: "error", message: "generic" };
  const member = await requireMember();
  const { error } = await member.supabase.rpc("close_conversation", {
    p_conversation: parsed.data,
  });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return { status: "done" };
}
