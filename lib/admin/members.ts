import * as z from "zod/mini";
import { parseMissing, type MissingKey } from "@/lib/onboarding/missing";

/**
 * Admin, Membres (10d): the filters of the list (admin_list_members) and the full record of a
 * member (admin_member_detail), as the database gives them. Never the true charge of the Casier
 * (règle 14): the record has no such field, and nothing here would read one.
 */
export const MEMBER_STATES = [
  "not_started",
  "onboarding",
  "active",
  "hidden",
  "suspended",
  "banned",
] as const;
export type MemberState = (typeof MEMBER_STATES)[number];

export const PAGE_SIZE = 50;

export type MemberFilters = {
  role: "bad" | "visitor" | null;
  state: MemberState | null;
  complete: boolean | null;
  blocked: boolean;
  page: number;
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The filters from the address of the page; anything unknown is no filter. */
export function parseMemberFilters(
  params: Record<string, string | string[] | undefined>,
): MemberFilters {
  const role = one(params.role);
  const state = one(params.etat);
  const complete = one(params.dossier);
  const page = Number(one(params.page) ?? 1);
  return {
    role: role === "bad" || role === "visitor" ? role : null,
    state: MEMBER_STATES.find((value) => value === state) ?? null,
    complete: complete === "termine" ? true : complete === "inacheve" ? false : null,
    blocked: one(params.bloques) === "1",
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** The query string of these filters (an other page, the same filters). */
export function memberFiltersQuery(filters: MemberFilters, page = filters.page): string {
  const query = new URLSearchParams();
  if (filters.role) query.set("role", filters.role);
  if (filters.state) query.set("etat", filters.state);
  if (filters.complete !== null) query.set("dossier", filters.complete ? "termine" : "inacheve");
  if (filters.blocked) query.set("bloques", "1");
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const HIDDEN_REASONS = [
  "not_bad",
  "dossier_incomplete",
  "banned",
  "hidden",
  "suspended",
  "paused",
  "dormant",
  "poses_not_validated",
  "no_casier",
  "zone_closed",
] as const;
export type HiddenReason = (typeof HIDDEN_REASONS)[number];

const nullableString = z.nullable(z.string());

const detailSchema = z.object({
  id: z.string(),
  has_profile: z.boolean(),
  account_created_at: z.string(),
  email_confirmed_at: nullableString,
  last_sign_in_at: nullableString,
  last_seen_at: nullableString,
  pseudo: nullableString,
  role: z.nullable(z.enum(["bad", "visitor"])),
  state: z.enum(MEMBER_STATES),
  gender: nullableString,
  age: z.nullable(z.number()),
  city: nullableString,
  zone: nullableString,
  seeking_genders: z.array(z.string()),
  seek_age_min: z.nullable(z.number()),
  seek_age_max: z.nullable(z.number()),
  bio: nullableString,
  visit_motive: nullableString,
  tribes: z.array(
    z.object({
      label: z.object({ fr: z.string(), en: z.string() }),
      detail: nullableString,
    }),
  ),
  casier: z.nullable(z.array(z.string())),
  answers: z.number(),
  photos: z.array(
    z.object({
      position: z.number(),
      status: z.enum(["pending", "approved", "rejected"]),
      rejection_reason: nullableString,
      cutout: z.boolean(),
      waived: z.boolean(),
      created_at: z.string(),
      reviewed_at: nullableString,
      pending_path: nullableString,
      public_small: nullableString,
    }),
  ),
  consents: z.array(
    z.object({
      type: z.string(),
      granted: z.boolean(),
      version: z.string(),
      created_at: z.string(),
    }),
  ),
  missing: z.array(z.string()),
  blocked: z.boolean(),
  hidden_reasons: z.nullable(z.array(z.enum(HIDDEN_REASONS))),
  /** 10e: the pseudos it had after the onboarding, its requests about the date of birth. */
  pseudo_history: z._default(
    z.array(z.object({ old_pseudo: z.string(), new_pseudo: z.string(), changed_at: z.string() })),
    [],
  ),
  birthdate_corrections: z._default(
    z.array(
      z.object({
        id: z.number(),
        status: z.enum(["pending", "accepted", "refused"]),
        created_at: z.string(),
        requested_age: z.nullable(z.number()),
        decided_at: nullableString,
      }),
    ),
    [],
  ),
});

export type MemberDetail = Omit<z.infer<typeof detailSchema>, "missing"> & {
  missing: MissingKey[];
};

/** The record as the database gives it, or null when it does not have the expected shape. */
export function parseMemberDetail(value: unknown): MemberDetail | null {
  if (value && typeof value === "object" && "true_index" in value) return null;
  const parsed = detailSchema.safeParse(value);
  if (!parsed.success) return null;
  const missing = parseMissing(parsed.data.missing);
  if (!missing) return null;
  return { ...parsed.data, missing };
}

const label = z.record(z.string(), z.string());
const counts = z.record(z.string(), z.number());

/**
 * The rest of the record (10i, admin_member_extra): exact date of birth, N° d'écrou, role and its
 * last change, the Interrogatoire, the activity, the settings. Never the true charge either.
 */
const extraSchema = z.object({
  birthdate: nullableString,
  ecrou: nullableString,
  role: z.nullable(z.enum(["bad", "visitor"])),
  role_changed_at: nullableString,
  answers: z.array(
    z.object({
      question: label,
      answer: z.nullable(label),
      accepted: z.array(label),
      importance: z.enum(["low", "important", "essential"]),
    }),
  ),
  activity: z.object({
    sent: counts,
    received: counts,
    last_requests: z.array(
      z.object({
        id: z.string(),
        created_at: z.string(),
        direction: z.enum(["sent", "received"]),
        other_id: z.string(),
        other_pseudo: nullableString,
        status: z.string(),
      }),
    ),
    visits_upcoming: z.number(),
    visits_honored: z.number(),
    visits_absent: z.number(),
    permits_open: z.number(),
    cavales_proposed: z.number(),
    cavales_accepted: z.number(),
    blocks_made: z.number(),
    blocks_received: z.number(),
    reports_made: z.number(),
    reports_received: z.number(),
    reports_open: z.number(),
    sanctions: z.array(
      z.object({
        action: z.string(),
        reason: nullableString,
        ends_at: nullableString,
        created_at: z.string(),
      }),
    ),
  }),
  settings: z.object({
    paused: z.boolean(),
    paused_at: nullableString,
    requests_cap: z.nullable(z.number()),
    requests_open: z.nullable(z.boolean()),
    requests_closed_manual: z.nullable(z.boolean()),
    pending_requests: z.nullable(z.number()),
    notifications: z.nullable(z.record(z.string(), z.unknown())),
    devices: z.number(),
    referral_code: nullableString,
    referrals: z.number(),
  }),
});

export type MemberExtra = z.infer<typeof extraSchema>;

/** The rest of the record as the database gives it, or null (and never with a true charge). */
export function parseMemberExtra(value: unknown): MemberExtra | null {
  if (JSON.stringify(value ?? null).includes("true_index")) return null;
  const parsed = extraSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
