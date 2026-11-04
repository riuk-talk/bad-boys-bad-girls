import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod/mini";
import {
  conversationSchema,
  messageSchema,
  readStateSchema,
  visitSchema,
  type Conversation,
  type Message,
  type Visit,
} from "@/lib/parloir";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** Opening a visit marks the member present (join_visit); participants only, otherwise null. */
export async function joinVisit(supabase: Client, visitId: string): Promise<Visit | null> {
  const { data, error } = await supabase.rpc("join_visit", { p_visit: visitId });
  if (error || !data) return null;
  const parsed = visitSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function loadConversation(
  supabase: Client,
  conversationId: string,
): Promise<Conversation | null> {
  const { data, error } = await supabase.rpc("get_conversation", {
    p_conversation: conversationId,
  });
  if (error || !data) return null;
  const parsed = conversationSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function loadMessages(supabase: Client, conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase.rpc("get_messages", { p_conversation: conversationId });
  if (error || !data) return [];
  const parsed = z.array(messageSchema).safeParse(data);
  return parsed.success ? parsed.data : [];
}

/**
 * Opening the conversation reads it: marked up to the last message rendered, on the server, so a
 * member who leaves at once (or whose browser is slow to run the client mark) is not left with an
 * unread counter for what they saw (Phase 6a).
 */
export async function markRendered(
  supabase: Client,
  conversationId: string,
  messages: readonly Message[],
): Promise<void> {
  const last = messages.at(-1)?.id;
  if (last === undefined) return;
  await supabase.rpc("mark_conversation_read", { p_conversation: conversationId, p_up_to: last });
}

/**
 * How far each one has read the conversation (Phase 6a), 0 when unknown: the other's mark gives
 * « Lu »; mine, read before the opening marks it, places « Nouveaux messages » (9l).
 */
export async function loadReadState(
  supabase: Client,
  conversationId: string,
): Promise<{ myReadId: number; otherReadId: number }> {
  const { data } = await supabase.rpc("get_read_state", { p_conversation: conversationId });
  const parsed = readStateSchema.safeParse(data);
  return parsed.success
    ? { myReadId: parsed.data.my_read_id, otherReadId: parsed.data.other_read_id }
    : { myReadId: 0, otherReadId: 0 };
}

/** The member's own pseudo (their profile row, RLS: owner only). */
export async function myPseudo(supabase: Client, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("pseudo").eq("id", userId).maybeSingle();
  return data?.pseudo ?? "";
}
