"use server";

import * as z from "zod/mini";
import { requireMember } from "@/lib/auth/user";
import { VENUE_MAX, VENUE_TYPES, datesSchema, type Dates } from "@/lib/cavale";
import { startFrom } from "@/lib/hours";
import { memberTimezone } from "@/lib/relations/schedule";
import { requestErrorKey } from "@/lib/relations/server";
import type { ActionState } from "./relations-actions";

/**
 * La Cavale (Phase 6). The rules (Permis permanent, one waiting proposal, 1 h to 60 days ahead,
 * the 24 h after « Pas encore », masking of the place) are checked by the SQL functions; these
 * actions validate the shape of the input, read the day and time in the member's quartier.
 */

const uuid = z
  .string()
  .check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));

const proposalInput = z.object({
  conversation: uuid,
  counter: z.optional(uuid),
  venueType: z.enum(VENUE_TYPES),
  venueName: z.string().check(z.minLength(2), z.maxLength(VENUE_MAX)),
  day: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
  time: z.string().check(z.regex(/^\d{2}:\d{2}$/)),
});

/** « Proposer une Cavale », or « Proposer autre chose » in answer to a waiting proposal. */
export async function proposeDateAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const counter = form.get("counter");
  const parsed = proposalInput.safeParse({
    conversation: form.get("conversation"),
    counter: typeof counter === "string" && counter !== "" ? counter : undefined,
    venueType: form.get("venueType"),
    venueName: String(form.get("venueName") ?? "").trim(),
    day: form.get("day"),
    time: form.get("time"),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      status: "error",
      message: field === "venueName" || field === "venueType" ? "venue_invalid" : "date_invalid",
    };
  }
  const member = await requireMember();
  const tz = await memberTimezone(member.supabase, member.userId);
  const start = startFrom(tz, parsed.data.day, parsed.data.time);
  if (!start) return { status: "error", message: "date_invalid" };
  const args = {
    p_venue_type: parsed.data.venueType,
    p_venue_name: parsed.data.venueName,
    p_starts_at: start.toISOString(),
  };
  const { error } = parsed.data.counter
    ? await member.supabase.rpc("counter_date", { p_proposal: parsed.data.counter, ...args })
    : await member.supabase.rpc("propose_date", {
        p_conversation: parsed.data.conversation,
        ...args,
      });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return { status: "done" };
}

const responseInput = z.object({ proposal: uuid, choice: z.enum(["accept", "not_yet"]) });

/** « Accepter » or « Pas encore ». */
export async function respondDateAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = responseInput.safeParse({
    proposal: form.get("proposal"),
    choice: form.get("choice"),
  });
  if (!parsed.success) return { status: "error", message: "choice_required" };
  const member = await requireMember();
  const { error } = await member.supabase.rpc("respond_date", {
    p_proposal: parsed.data.proposal,
    p_accept: parsed.data.choice === "accept",
  });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return { status: "done" };
}

/** Cancelling an accepted Cavale (either one, one gesture) or one's own waiting proposal. */
export async function cancelDateAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = uuid.safeParse(form.get("proposal"));
  if (!parsed.success) return { status: "error", message: "generic" };
  const member = await requireMember();
  const { error } = await member.supabase.rpc("cancel_date", { p_proposal: parsed.data });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return { status: "done" };
}

/** The Cavale of the conversation, read again by the screen (after an answer, every 15 s). */
export async function loadDatesAction(conversationId: string): Promise<Dates | null> {
  const id = uuid.safeParse(conversationId);
  if (!id.success) return null;
  const member = await requireMember();
  const { data, error } = await member.supabase.rpc("get_dates", { p_conversation: id.data });
  if (error || !data) return null;
  const parsed = datesSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
