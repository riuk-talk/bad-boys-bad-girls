"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth/user";

/** E-mail preferences, one switch per type (SPEC §16). Column privileges limit what is written. */
export async function updateEmailPreferencesAction(form: FormData): Promise<void> {
  const member = await requireMember();
  const on = (name: string) => form.get(name) === "on";
  await member.supabase
    .from("notification_preferences")
    .update({
      email_request_digest: on("request_digest"),
      email_date_accepted: on("date_accepted"),
      email_zone_opened: on("zone_opened"),
      email_dormant: on("profile_dormant"),
      email_visit_reminder: on("visit_reminder"),
      email_permit_granted: on("permit_granted"),
    })
    .eq("user_id", member.userId);
  revalidatePath("/[locale]/ma-fiche", "page");
}
