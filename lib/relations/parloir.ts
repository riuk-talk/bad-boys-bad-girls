import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod/mini";
import {
  conversationSchema,
  messageSchema,
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

/** The member's own pseudo (their profile row, RLS: owner only). */
export async function myPseudo(supabase: Client, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("pseudo").eq("id", userId).maybeSingle();
  return data?.pseudo ?? "";
}
