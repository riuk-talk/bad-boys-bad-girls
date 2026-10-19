"use server";

import { requireMember } from "@/lib/auth/user";
import { totalUnread } from "@/lib/parloir";
import type { Database } from "@/lib/supabase/database.types";

type NotificationType = Database["public"]["Enums"]["notification_type"];

export type TabState = { types: NotificationType[]; unread: number };

/** What the tab bar shows (SPEC §13: counters read by polling every 60 s and on tab return). */
export async function tabStateAction(): Promise<TabState> {
  const member = await requireMember();
  const [{ data: notifications }, { data: counts }] = await Promise.all([
    member.supabase.from("notifications").select("type").is("read_at", null).limit(200),
    member.supabase.rpc("get_unread_counts"),
  ]);
  return {
    types: [...new Set((notifications ?? []).map((row) => row.type))],
    unread: totalUnread(counts ?? []),
  };
}
