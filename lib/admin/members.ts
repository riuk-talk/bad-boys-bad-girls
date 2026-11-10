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
