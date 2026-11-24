"use server";

import * as z from "zod/mini";
import { requireMember } from "@/lib/auth/user";

export type EmailResult = { email: string } | { error: "forbidden" | "not_found" | "generic" };

/**
 * « Afficher l'e-mail » (10i): the database checks members.email and the second factor, and logs
 * each showing (greffe_fiche_views, context « email »). Never in a list, never in the page before
 * this click.
 */
export async function revealEmailAction(memberId: string): Promise<EmailResult> {
  const id = z.uuid().safeParse(memberId);
  if (!id.success) return { error: "not_found" };
  const member = await requireMember();
  const { data, error } = await member.supabase.rpc("admin_member_email", { p_user: id.data });
  if (error) {
    if (error.message.includes("admin_only")) return { error: "forbidden" };
    if (error.message.includes("not_found")) return { error: "not_found" };
    return { error: "generic" };
  }
  return typeof data === "string" ? { email: data } : { error: "generic" };
}
