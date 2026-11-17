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

export const photoSchema = z.object({
  position: z.number(),
  large: z.nullable(z.string()),
  small: z.nullable(z.string()),
  /** Cut out in the browser: shown in front of the wall (2026-10-23, version B). */
  cutout: z.optional(z.boolean()),
  /** Validated by the Greffe without cut-out (9k): shown as a stapled print. */
  waived: z.optional(z.boolean()),
});
export const tribeSchema = z.object({ label, detail: z.nullable(z.string()) });
const commonPoint = z.object({ question: label, answer: label });
export const genderSchema = z.enum(["man", "woman", "non_binary", "other"]);

export const ficheSchema = z.object({
  id: z.string(),
  ecrou: z.nullable(z.string()),
  pseudo: z.string(),
  gender: genderSchema,
  age: z.nullable(z.number()),
  city: z.nullable(z.string()),
  distance_km: z.nullable(z.number()),
  seeking_genders: z.array(genderSchema),
  seek_age_min: z.number(),
  seek_age_max: z.number(),
  on_file_since: z.string(),
  photos: z.array(photoSchema),
  tribes: z.array(tribeSchema),
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
  gender: genderSchema,
  age: z.nullable(z.number()),
  city: z.nullable(z.string()),
  distance_km: z.nullable(z.number()),
  photo: z.nullable(photoSchema),
  motive: z.nullable(z.string()),
  tribes: z.array(tribeSchema),
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

/**
 * A French inclusive label (« Tatoué·e », « Rockeur·se ») agreed with the gender of the person it
 * describes: « Tatoué » for a man, « Tatouée » for a woman, unchanged for a non-binary or other
 * person (9i). Labels without a middle dot, and English ones, stay as they are.
 */
export function agreeLabel(label: string, gender: Gender | null | undefined): string {
  if (gender !== "man" && gender !== "woman") return label;
  return label.replace(/([\p{L}]+)·([\p{L}]+)/gu, (_, base: string, suffix: string) => {
    if (gender === "man") return base;
    // Rockeur·se → Rockeuse, Créateur·rice → Créatrice, Tatoué·e → Tatouée, Musicien·ne → Musicienne.
    if (suffix === "se" && base.endsWith("eur")) return `${base.slice(0, -1)}se`;
    if (suffix === "rice" && base.endsWith("teur")) return `${base.slice(0, -3)}rice`;
    return `${base}${suffix}`;
  });
}

/** « Biker · Triumph de 1974 »; the label agreed with the gender of the person when given. */
export function tribeText(
  tribeValue: { label: Label; detail: string | null },
  locale: string,
  gender?: Gender | null,
) {
  const name = agreeLabel(localize(tribeValue.label, locale), gender);
  return tribeValue.detail ? `${name} · ${tribeValue.detail}` : name;
}
