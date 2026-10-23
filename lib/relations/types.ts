import * as z from "zod/mini";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Shapes of what the member functions of Phase 4 return (get_fiche, get_permit). They never
 * contain the true line, the chosen charge, the Casier copy or the result of the bet (rule 14).
 */

export type Gender = Database["public"]["Enums"]["gender"];
export type RequestStatus = Database["public"]["Enums"]["visit_request_status"];

const label = z.object({ fr: z.optional(z.string()), en: z.optional(z.string()) });
export type Label = z.infer<typeof label>;

const photo = z.object({
  position: z.number(),
  large: z.nullable(z.string()),
  small: z.nullable(z.string()),
  /** Cut out in the browser: shown in front of the wall (2026-10-23, version B). */
  cutout: z.optional(z.boolean()),
});
const tribe = z.object({ label, detail: z.nullable(z.string()) });
const commonPoint = z.object({ question: label, answer: label });
const gender = z.enum(["man", "woman", "non_binary", "other"]);

export const ficheSchema = z.object({
  id: z.string(),
  ecrou: z.nullable(z.string()),
  pseudo: z.string(),
  gender,
  age: z.nullable(z.number()),
  city: z.nullable(z.string()),
  distance_km: z.nullable(z.number()),
  seeking_genders: z.array(gender),
  seek_age_min: z.number(),
  seek_age_max: z.number(),
  on_file_since: z.string(),
  photos: z.array(photo),
  tribes: z.array(tribe),
  charges: z.array(z.string()),
  casier_changed_since_request: z.boolean(),
  bio: z.nullable(z.string()),
  good_conduct: z.boolean(),
  /** « Complices recrutés » (SPEC §5 [P1], Phase 9c): members brought in by this Bad. */
  recruited: z.number().check(z.int(), z.gte(0)),
  requests_open: z.boolean(),
  complicity: z.nullable(z.number()),
  common_points: z.array(commonPoint),
  my_request_status: z.nullable(z.string()),
  cooldown_until: z.nullable(z.string()),
});
export type FicheView = z.infer<typeof ficheSchema>;

export const permitSchema = z.object({
  id: z.string(),
  pseudo: z.string(),
  gender,
  age: z.nullable(z.number()),
  city: z.nullable(z.string()),
  distance_km: z.nullable(z.number()),
  photo: z.nullable(photo),
  motive: z.nullable(z.string()),
  tribes: z.array(tribe),
  clean_record: z.boolean(),
  visits_honored: z.number(),
  visits_due: z.number(),
  complicity: z.nullable(z.number()),
  common_points: z.array(commonPoint),
});
export type PermitView = z.infer<typeof permitSchema>;

export function localize(value: Label | null | undefined, locale: string): string {
  if (!value) return "";
  return (locale === "en" ? value.en : value.fr) ?? value.fr ?? value.en ?? "";
}

/** « Biker · Triumph de 1974 » */
export function tribeText(tribeValue: { label: Label; detail: string | null }, locale: string) {
  const name = localize(tribeValue.label, locale);
  return tribeValue.detail ? `${name} · ${tribeValue.detail}` : name;
}
