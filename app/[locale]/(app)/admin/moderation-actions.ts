"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import * as z from "zod/mini";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import {
  FLAG_DECISIONS,
  MEMBER_SANCTIONS,
  REPORT_SANCTIONS,
  SUSPENSION_DAYS_MAX,
  moderationErrorKey,
  motiveSchema,
  type ModerationError,
} from "@/lib/moderation";

/**
 * Moderation decisions (SPEC §10 DSA, §15). Postgres checks everything again: the admin and the
 * second factor (is_admin()), the motives, the sanctions allowed, who may be sanctioned. These
 * actions only validate the form and come back to the page with the outcome.
 */

async function back(path: string, error?: ModerationError): Promise<never> {
  revalidatePath(`/[locale]${path}`, "page");
  return redirect({
    href: error ? `${path}?error=${error}` : `${path}?done=1`,
    locale: await getLocale(),
  });
}

const daysSchema = z.optional(
  z.coerce.number().check(z.int(), z.minimum(1), z.maximum(SUSPENSION_DAYS_MAX)),
);

const reportSchema = z.object({
  report: z.coerce.number().check(z.int(), z.positive()),
  outcome: z.enum(["upheld", "rejected"]),
  reasonReporter: motiveSchema,
  action: z.optional(z.enum(REPORT_SANCTIONS)),
  reasonTarget: z.optional(motiveSchema),
  days: daysSchema,
});

export async function decideReportAction(form: FormData): Promise<void> {
  const path = "/admin/signalements";
  const outcome = form.get("outcome");
  const parsed = reportSchema.safeParse({
    report: form.get("report"),
    outcome,
    reasonReporter: form.get("reasonReporter"),
    action: outcome === "upheld" ? form.get("action") || undefined : undefined,
    reasonTarget: outcome === "upheld" ? form.get("reasonTarget") || undefined : undefined,
    days: outcome === "upheld" && form.get("action") === "suspend" ? form.get("days") : undefined,
  });
  if (!parsed.success) {
    const days = parsed.error.issues.some((issue) => issue.path[0] === "days");
    return back(path, days ? "invalid_days" : "reason_required");
  }
  const { report, reasonReporter, action, reasonTarget, days } = parsed.data;
  const upheld = parsed.data.outcome === "upheld";
  if (upheld && (!action || !reasonTarget))
    return back(path, action ? "reason_required" : "invalid_action");
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_decide_report", {
    p_report: report,
    p_upheld: upheld,
    p_reason_reporter: reasonReporter,
    p_action: upheld ? action : undefined,
    p_reason_target: upheld ? reasonTarget : undefined,
    p_days: upheld && action === "suspend" ? days : undefined,
  });
  return back(path, error ? moderationErrorKey(error.message) : undefined);
}

const flagSchema = z.object({
  flag: z.coerce.number().check(z.int(), z.positive()),
  decision: z.enum(FLAG_DECISIONS),
  reason: z.optional(z.string().check(z.trim(), z.maxLength(1000))),
});

export async function decideFlagAction(form: FormData): Promise<void> {
  const path = "/admin/textes";
  const parsed = flagSchema.safeParse({
    flag: form.get("flag"),
    decision: form.get("decision"),
    reason: form.get("reason") || undefined,
  });
  if (!parsed.success) return back(path, "generic");
  const { flag, decision, reason } = parsed.data;
  if (decision !== "clear" && !motiveSchema.safeParse(reason ?? "").success) {
    return back(path, "reason_required");
  }
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_decide_flag", {
    p_flag: flag,
    p_decision: decision,
    p_reason: reason,
  });
  return back(path, error ? moderationErrorKey(error.message) : undefined);
}

const sanctionSchema = z.object({
  member: z.uuid(),
  action: z.enum(MEMBER_SANCTIONS),
  reason: motiveSchema,
  days: daysSchema,
});

export async function sanctionAction(form: FormData): Promise<void> {
  const memberId = z.uuid().safeParse(form.get("member"));
  if (!memberId.success) return back("/admin/membres", "generic");
  const path = `/admin/membres/${memberId.data}`;
  const parsed = sanctionSchema.safeParse({
    member: form.get("member"),
    action: form.get("action"),
    reason: form.get("reason"),
    days: form.get("action") === "suspend" ? form.get("days") : undefined,
  });
  if (!parsed.success) {
    const days = parsed.error.issues.some((issue) => issue.path[0] === "days");
    return back(path, days ? "invalid_days" : "reason_required");
  }
  const { action, reason, days } = parsed.data;
  if (action === "suspend" && days === undefined) return back(path, "invalid_days");
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_sanction", {
    p_user: memberId.data,
    p_action: action,
    p_reason: reason,
    p_days: action === "suspend" ? days : undefined,
  });
  return back(path, error ? moderationErrorKey(error.message) : undefined);
}
