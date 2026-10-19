import * as z from "zod/mini";

/**
 * La Cavale (Phase 6, SPEC §13): a real date for two, proposed in the Parloir sans horaire. Every
 * rule (one waiting proposal, the 24 h after « Pas encore », the dates, the masking) lives in
 * Postgres; this module reads get_dates and mirrors the « lieu privé » warning shown while typing.
 */

export const VENUE_TYPES = ["bar", "cafe", "concert", "walk", "activity"] as const;
export type VenueType = (typeof VENUE_TYPES)[number];

export const VENUE_MAX = 120;
/** At least 1 h ahead, within 60 days (propose_date). */
export const MIN_LEAD_MS = 60 * 60 * 1000;
export const MAX_LEAD_MS = 60 * 24 * 60 * 60 * 1000;

const proposal = z.object({
  id: z.string(),
  venue_type: z.enum(VENUE_TYPES),
  venue_name: z.string(),
  starts_at: z.string(),
  private_place_warning: z.boolean(),
  mine: z.boolean(),
});

export const datesSchema = z.object({
  pending: z.nullable(z.extend(proposal, { countered: z.boolean() })),
  accepted: z.nullable(proposal),
  wait_until: z.nullable(z.string()),
  can_propose: z.boolean(),
});
export type Dates = z.infer<typeof datesSchema>;
export type Proposal = z.infer<typeof proposal>;

/** Same normalisation as public.normalize_text: lower case, no accents, letters and digits. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Mirror of public.looks_private_place (pgTAP and Vitest cover the same cases).
const PRIVATE_PLACE = new RegExp(
  [
    " chez (moi|toi|nous|vous|lui|elle|eux|mon|ma|ton|ta) ",
    " (a|a la) maison ",
    " domicile ",
    " (mon|ton|notre|votre) (appart|appartement|studio|logement) ",
    " my place ",
    " your place ",
    " at home ",
    " my flat ",
    " your flat ",
    " [0-9]+ ?(bis |ter )?(rue|avenue|av|boulevard|bd|chemin|allee|impasse|place|route|quai|cours|square|residence|lotissement|street|road) ",
  ].join("|"),
);

/** « chez moi », « à la maison », an address…: a public place is advised (a warning, never a refusal). */
export function looksPrivatePlace(text: string): boolean {
  return PRIVATE_PLACE.test(` ${normalize(text)} `);
}

/** Why a date cannot be proposed, or null (the database checks it again). */
export function cavaleTimeError(start: Date, now: Date): "too_soon" | "too_far" | null {
  if (start.getTime() < now.getTime() + MIN_LEAD_MS) return "too_soon";
  if (start.getTime() > now.getTime() + MAX_LEAD_MS) return "too_far";
  return null;
}
