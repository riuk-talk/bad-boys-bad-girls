import * as z from "zod/mini";

/** La modération (SPEC §10 DSA, §15): shapes of what Postgres returns, and the limits it checks. */

export const REPORT_CATEGORIES = [
  "fake_profile",
  "minor",
  "harassment",
  "sexual_content",
  "violence_threat",
  "scam",
  "other",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_TARGETS = [
  "profile",
  "permit",
  "photo",
  "casier",
  "message",
  "visit_request",
] as const;

/** Sanctions an admin applies from a member's record (admin_sanction). */
export const MEMBER_SANCTIONS = [
  "warn",
  "suspend",
  "ban",
  "unban",
  "hide_profile",
  "unhide_profile",
  "revoke_good_conduct",
] as const;
export type MemberSanction = (typeof MEMBER_SANCTIONS)[number];

/** Sanctions that go with an upheld report (admin_decide_report). */
export const REPORT_SANCTIONS = ["warn", "suspend", "ban", "hide_profile"] as const;
export type ReportSanction = (typeof REPORT_SANCTIONS)[number];

/** Every action recorded in moderation_actions. */
export const ACTIONS = [
  "warn",
  "suspend",
  "ban",
  "unban",
  "hide_profile",
  "unhide_profile",
  "photo_approve",
  "photo_reject",
  "photo_cutout_waive",
  "text_clear",
  "text_remove",
  "revoke_good_conduct",
] as const;
export type Action = (typeof ACTIONS)[number];

export const FLAG_DECISIONS = ["clear", "uphold", "remove"] as const;
export type FlagDecision = (typeof FLAG_DECISIONS)[number];

export const FLAG_SOURCES = [
  "pseudo",
  "bio",
  "visit_motive",
  "casier",
  "tribe_detail",
  "visit_request",
  "message",
  "date_venue",
] as const;

/** Same bounds as private.motive(): 10 to 1,000 characters once trimmed. */
export const MOTIVE_MIN = 10;
export const MOTIVE_MAX = 1000;
export const SUSPENSION_DAYS_MAX = 90;

export const motiveSchema = z
  .string()
  .check(z.trim(), z.minLength(MOTIVE_MIN, "motive"), z.maxLength(MOTIVE_MAX, "motive"));

const status = z.enum(["open", "upheld", "rejected"]);

export const sanctionSchema = z.nullable(
  z.object({
    state: z.enum(["banned", "suspended", "hidden", "review"]),
    reason: z.optional(z.nullable(z.string())),
    until: z.optional(z.string()),
  }),
);
export type Sanction = z.infer<typeof sanctionSchema>;

export const decisionsSchema = z.object({
  reports: z.array(
    z.object({
      id: z.number(),
      created_at: z.string(),
      category: z.enum(REPORT_CATEGORIES),
      target_type: z.enum(REPORT_TARGETS),
      status,
      decided_at: z.nullable(z.string()),
      reason: z.nullable(z.string()),
    }),
  ),
  decisions: z.array(
    z.object({
      id: z.number(),
      created_at: z.string(),
      action: z.enum(ACTIONS),
      reason: z.nullable(z.string()),
      ends_at: z.nullable(z.string()),
    }),
  ),
});
export type Decisions = z.infer<typeof decisionsSchema>;

export const memberRecordSchema = z.object({
  id: z.string(),
  pseudo: z.nullable(z.string()),
  role: z.nullable(z.enum(["bad", "visitor"])),
  gender: z.nullable(z.string()),
  created_at: z.string(),
  last_seen_at: z.nullable(z.string()),
  state: z.enum(["banned", "suspended", "hidden", "onboarding", "active"]),
  suspended_until: z.nullable(z.string()),
  hidden_reason: z.nullable(z.string()),
  banned_at: z.nullable(z.string()),
  good_conduct: z.boolean(),
  is_admin: z.boolean(),
  zone: z.nullable(z.string()),
  reports_made: z.number(),
  reports_received: z.array(
    z.object({
      id: z.number(),
      created_at: z.string(),
      category: z.enum(REPORT_CATEGORIES),
      target_type: z.enum(REPORT_TARGETS),
      status,
      comment: z.nullable(z.string()),
      decision_reason: z.nullable(z.string()),
    }),
  ),
  actions: z.array(
    z.object({
      id: z.number(),
      created_at: z.string(),
      action: z.enum(ACTIONS),
      reason: z.nullable(z.string()),
      ends_at: z.nullable(z.string()),
      report_id: z.nullable(z.number()),
    }),
  ),
  flags: z.array(
    z.object({
      id: z.number(),
      created_at: z.string(),
      source: z.enum(FLAG_SOURCES),
      excerpt: z.string(),
      status,
    }),
  ),
});
export type MemberRecord = z.infer<typeof memberRecordSchema>;

const ERROR_KEYS = [
  "reason_required",
  "invalid_action",
  "invalid_days",
  "already_decided",
  "already_banned",
  "not_banned",
  "already_hidden",
  "not_hidden",
  "no_good_conduct",
  "not_removable",
  "self_sanction",
  "admin_protected",
  "super_admin_only",
  "not_found",
  "underage",
  "invalid_reason",
] as const;
export type ModerationError = (typeof ERROR_KEYS)[number] | "generic";

/** The error key raised by Postgres (its message), or "generic". */
export function moderationErrorKey(message: string | undefined): ModerationError {
  return ERROR_KEYS.find((key) => message === key) ?? "generic";
}

export function isModerationError(value: string | undefined): value is ModerationError {
  return value === "generic" || ERROR_KEYS.some((key) => key === value);
}
