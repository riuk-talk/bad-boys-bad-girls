"use server";

import { getLocale } from "next-intl/server";
import * as z from "zod/mini";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { requestErrorKey } from "@/lib/relations/server";
import type { ActionState } from "./relations-actions";

/**
 * Les Heures de visite (Phase 5b). Every rule (2 or 3 slots, 2 h ahead, 7 days, no overlap,
 * 48 h to choose, « Aucun ne me va » once, cancellation) lives in the SQL functions; these
 * actions only check the shape of the input and translate the error codes.
 */

const uuid = z
  .string()
  .check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));
const instant = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(\.000)?Z$/));

const proposeSchema = z.object({
  request: uuid,
  mode: z.enum(["accept", "repropose"]),
  slots: z.array(instant).check(z.minLength(2), z.maxLength(3)),
});

/** The Bad sends 2 or 3 slots: the acceptance itself, or new slots after a refusal or a cancellation. */
export async function proposeHoursAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = proposeSchema.safeParse({
    request: form.get("request"),
    mode: form.get("mode"),
    slots: form.getAll("slot").map(String),
  });
  if (!parsed.success) return { status: "error", message: "slots_count" };
  const member = await requireMember();
  const { request, mode, slots } = parsed.data;
  const { error } = await member.supabase.rpc(
    mode === "accept" ? "accept_visit_request" : "propose_slots",
    { p_request: request, p_slots: slots },
  );
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return redirect({ href: `/courrier/${request}?envoye=1`, locale: await getLocale() });
}

/** The Visitor confirms one of the slots: the visit is scheduled. */
export async function chooseSlotAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = uuid.safeParse(form.get("slot"));
  if (!parsed.success) return { status: "error", message: "slot_required" };
  const member = await requireMember();
  const { error } = await member.supabase.rpc("choose_slot", { p_slot: parsed.data });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return { status: "done" };
}

/** « Aucun ne me va » (once per request): the Bad has 48 h to propose new slots. */
export async function declineSlotsAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = uuid.safeParse(form.get("request"));
  if (!parsed.success) return { status: "error", message: "generic" };
  const member = await requireMember();
  const { error } = await member.supabase.rpc("decline_slots", { p_request: parsed.data });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return { status: "done" };
}

/** Cancelling a scheduled visit (either side): the other one gets a neutral message. */
export async function cancelVisitAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = uuid.safeParse(form.get("visit"));
  if (!parsed.success) return { status: "error", message: "generic" };
  const member = await requireMember();
  const { error } = await member.supabase.rpc("cancel_visit", { p_visit: parsed.data });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return { status: "done" };
}

/** « Affaire classée » by the Bad after the Visitor's absence (instead of new slots). */
export async function closeAfterAbsenceAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = uuid.safeParse(form.get("request"));
  if (!parsed.success) return { status: "error", message: "generic" };
  const member = await requireMember();
  const { error } = await member.supabase.rpc("close_after_absence", { p_request: parsed.data });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return { status: "done" };
}
