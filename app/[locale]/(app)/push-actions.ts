"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import * as z from "zod/mini";
import { requireMember } from "@/lib/auth/user";
import type { ActionState } from "./relations-actions";

/**
 * Web Push (Phase 5a). The checks (HTTPS address, key sizes, 5 browsers at most, own
 * subscriptions only) live in the SQL functions; these only validate the shape.
 */

const IDLE_ERROR: ActionState = { status: "error", message: "generic" };

const subscriptionSchema = z.object({
  endpoint: z.string().check(z.maxLength(1000), z.startsWith("https://")),
  p256dh: z.string().check(z.minLength(40), z.maxLength(200)),
  auth: z.string().check(z.minLength(10), z.maxLength(100)),
});

/** Saves this browser's subscription, with the language its notifications will be written in. */
export async function savePushSubscriptionAction(input: unknown): Promise<ActionState> {
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return IDLE_ERROR;
  const member = await requireMember();
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  const { error } = await member.supabase.rpc("save_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.p256dh,
    p_auth: parsed.data.auth,
    p_locale: locale,
  });
  if (error) return IDLE_ERROR;
  revalidatePath("/[locale]/ma-fiche", "page");
  return { status: "done" };
}

/** Switches notifications off on this browser: address and keys are erased at once. */
export async function revokePushSubscriptionAction(endpoint: unknown): Promise<ActionState> {
  const parsed = z.string().check(z.maxLength(1000)).safeParse(endpoint);
  if (!parsed.success) return IDLE_ERROR;
  const member = await requireMember();
  const { error } = await member.supabase.rpc("revoke_push_subscription", {
    p_endpoint: parsed.data,
  });
  if (error) return IDLE_ERROR;
  revalidatePath("/[locale]/ma-fiche", "page");
  return { status: "done" };
}

/** « Plus tard » or a refusal in the browser: the offer is not repeated for 30 days. */
export async function declinePushPromptAction(): Promise<ActionState> {
  const member = await requireMember();
  const { error } = await member.supabase
    .from("notification_preferences")
    .update({ push_prompt_declined_at: new Date().toISOString() })
    .eq("user_id", member.userId);
  return error ? IDLE_ERROR : { status: "done" };
}

/** Which kinds of notifications are pushed (all browsers of the member). */
export async function pushPreferencesAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const member = await requireMember();
  const { error } = await member.supabase
    .from("notification_preferences")
    .update({
      push_requests: form.get("requests") === "1",
      push_promenade: form.get("promenade") === "1",
      push_visits: form.get("visits") === "1",
    })
    .eq("user_id", member.userId);
  if (error) return IDLE_ERROR;
  revalidatePath("/[locale]/ma-fiche", "page");
  return { status: "done" };
}
