"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import * as z from "zod/mini";
import { requireMember } from "@/lib/auth/user";
import { requestErrorKey } from "@/lib/relations/server";

/**
 * Server actions of Phase 4. Every rule lives in the SQL functions (limits, visibility, blocks,
 * rule 14); these only validate the input shape and translate the error codes.
 */

export type ActionState =
  { status: "idle" } | { status: "done" } | { status: "error"; message: string };

const uuid = z
  .string()
  .check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));
const IDLE_ERROR: ActionState = { status: "error", message: "generic" };

/**
 * Settings that change the whole screen refresh it. A request, a decision or a report do not:
 * their screen shows its own result (« Demande déposée », the stamp) and the next page reads fresh data.
 */
function refresh() {
  revalidatePath("/[locale]", "layout");
}

const requestSchema = z.object({
  bad: uuid,
  guess: z.coerce.number().check(z.int(), z.gte(1), z.lte(3)),
  note: z.string().check(z.maxLength(400)),
});

/** La Demande de parloir: the bet and the note. Nothing about the bet ever comes back. */
export async function sendVisitRequestAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = requestSchema.safeParse({
    bad: form.get("bad"),
    guess: form.get("guess"),
    note: String(form.get("note") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", message: form.get("guess") ? "generic" : "guessRequired" };
  }
  const note = parsed.data.note.trim();
  if ([...note].length > 280) return { status: "error", message: "note_too_long" };
  const member = await requireMember();
  const { error } = await member.supabase.rpc("send_visit_request", {
    p_bad: parsed.data.bad,
    p_guessed_index: parsed.data.guess,
    p_note: note.length > 0 ? note : undefined,
  });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return { status: "done" };
}

const decisionSchema = z.object({ request: uuid, accept: z.enum(["1", "0"]) });

/** Le Courrier: « Accepter la visite » or « Affaire classée » (Bad only, checked in SQL). */
export async function decideVisitRequestAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = decisionSchema.safeParse({
    request: form.get("request"),
    accept: form.get("accept"),
  });
  if (!parsed.success) return IDLE_ERROR;
  const member = await requireMember();
  const { error } = await member.supabase.rpc("decide_visit_request", {
    p_request: parsed.data.request,
    p_accept: parsed.data.accept === "1",
  });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return { status: "done" };
}

const REPORT_TARGETS = ["profile", "permit", "visit_request", "message", "greffe_message"] as const;
const REPORT_CATEGORIES = [
  "fake_profile",
  "minor",
  "harassment",
  "sexual_content",
  "violence_threat",
  "scam",
  "other",
] as const;
const reportSchema = z.object({
  type: z.enum(REPORT_TARGETS),
  // A uuid, or the number of a message of the Parloir.
  target: z.union([uuid, z.string().check(z.regex(/^[0-9]{1,18}$/))]),
  category: z.enum(REPORT_CATEGORIES),
  comment: z.string().check(z.maxLength(500)),
});

/** Signaler: a profile, a Permis or a request, within the reporter's reach (checked in SQL). */
export async function reportAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = reportSchema.safeParse({
    type: form.get("type"),
    target: form.get("target"),
    category: form.get("category"),
    comment: String(form.get("comment") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", message: form.get("category") ? "generic" : "categoryRequired" };
  }
  const member = await requireMember();
  const comment = parsed.data.comment.trim();
  // A message of the team in the Courrier du Greffe (10g): its own function (no member targeted).
  if (parsed.data.type === "greffe_message") {
    const { error } = await member.supabase.rpc("greffe_report_message", {
      p_message: Number(parsed.data.target),
      p_category: parsed.data.category,
      p_comment: comment.length > 0 ? comment : undefined,
    });
    if (error) return { status: "error", message: requestErrorKey(error.message) };
    return { status: "done" };
  }
  const { error } = await member.supabase.rpc("report", {
    p_target_type: parsed.data.type,
    p_target_id: parsed.data.target,
    p_category: parsed.data.category,
    p_comment: comment.length > 0 ? comment : undefined,
  });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  return { status: "done" };
}

const targetSchema = z.object({ target: uuid });
const blockSchema = z.object({
  target: uuid,
  next: z.enum(["/promenade", "/courrier", "/visites"]),
});

/**
 * Bloquer: the other member disappears everywhere; requests in progress are closed. The member
 * leaves the blocked person's page at once (it no longer exists for them).
 */
export async function blockAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = blockSchema.safeParse({ target: form.get("target"), next: form.get("next") });
  if (!parsed.success) return IDLE_ERROR;
  const member = await requireMember();
  const { error } = await member.supabase.rpc("block_user", { p_target: parsed.data.target });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  refresh();
  return redirect({ href: parsed.data.next, locale: await getLocale() });
}

/** Débloquer (from Ma Fiche): the history stays, the block ends. */
export async function unblockAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = targetSchema.safeParse({ target: form.get("target") });
  if (!parsed.success) return IDLE_ERROR;
  const member = await requireMember();
  const { error } = await member.supabase.rpc("unblock_user", { p_target: parsed.data.target });
  if (error) return IDLE_ERROR;
  refresh();
  return { status: "done" };
}

const mailboxSchema = z.object({
  cap: z.coerce.number().check(z.int(), z.gte(5), z.lte(50)),
  closed: z.boolean(),
});

/** The Bad's request cap (5–50) and the manual « Parloir complet » (SPEC §7). */
export async function mailboxSettingsAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = mailboxSchema.safeParse({
    cap: form.get("cap"),
    closed: form.get("closed") === "1",
  });
  if (!parsed.success) return IDLE_ERROR;
  const member = await requireMember();
  const { error } = await member.supabase
    .from("profiles")
    .update({ requests_cap: parsed.data.cap, requests_closed_manual: parsed.data.closed })
    .eq("id", member.userId);
  if (error) return IDLE_ERROR;
  refresh();
  return { status: "done" };
}

const pauseSchema = z.object({ paused: z.enum(["1", "0"]) });

/** Mettre ma Fiche en pause: hidden everywhere, requests refused, nothing deleted (SPEC §2 bis). */
export async function pauseAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = pauseSchema.safeParse({ paused: form.get("paused") });
  if (!parsed.success) return IDLE_ERROR;
  const member = await requireMember();
  const { error } = await member.supabase
    .from("profiles")
    .update({ is_paused: parsed.data.paused === "1" })
    .eq("id", member.userId);
  if (error) return IDLE_ERROR;
  refresh();
  return { status: "done" };
}

const roleSchema = z.object({ role: z.enum(["bad", "visitor"]) });

/** Changer de rôle (SPEC §2 bis): once per 7 days, effects in SQL (change_role). */
export async function changeRoleAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const parsed = roleSchema.safeParse({ role: form.get("role") });
  if (!parsed.success) return IDLE_ERROR;
  const member = await requireMember();
  const { error } = await member.supabase.rpc("change_role", { p_role: parsed.data.role });
  if (error) return { status: "error", message: requestErrorKey(error.message) };
  refresh();
  return { status: "done" };
}
