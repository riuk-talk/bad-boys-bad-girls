"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { moderationErrorKey, type ModerationError } from "@/lib/moderation";
import { decisionSchema } from "@/lib/validation/identity";

async function back(error?: ModerationError): Promise<never> {
  revalidatePath("/[locale]/admin/corrections", "page");
  return redirect({
    href: error ? `/admin/corrections?error=${error}` : "/admin/corrections?done=1",
    locale: await getLocale(),
  });
}

/**
 * The Greffe decides a request to correct a date of birth (10e). Postgres checks everything again:
 * the admin and the second factor, the request still waiting, 18 or more, a motive to refuse; it
 * keeps the decision (who, when, why) and notifies the member.
 */
export async function decideCorrectionAction(form: FormData): Promise<void> {
  const parsed = decisionSchema.safeParse({
    correction: form.get("correction"),
    decision: form.get("decision"),
    reason: form.get("reason") || undefined,
  });
  if (!parsed.success) return back("generic");
  const { correction, decision, reason } = parsed.data;
  if (decision === "refuse" && !reason) return back("reason_required");
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_decide_birthdate_correction", {
    p_correction: correction,
    p_accept: decision === "accept",
    p_reason: reason,
  });
  if (error) return back(moderationErrorKey(error.message));
  return back();
}
