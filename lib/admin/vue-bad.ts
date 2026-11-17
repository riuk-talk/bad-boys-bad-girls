import * as z from "zod/mini";
import { genderSchema, photoSchema, tribeSchema, type Gender } from "@/lib/relations/types";

/**
 * « Voir comme un Bad » (10f-bis): the filters of the list (from the address of the page) and
 * the rows admin_view_visitors gives, read as the Permis a Bad sees in its Courrier.
 */
export const PAGE_SIZE = 24;

export type VueBadFilters = {
  gender: Gender | null;
  ageMin: number | null;
  ageMax: number | null;
  zone: number | null;
  page: number;
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const age = (value: string | undefined) => {
  const n = Number(value);
  return value && Number.isInteger(n) && n >= 18 && n <= 99 ? n : null;
};

export function parseVueBadFilters(
  params: Record<string, string | string[] | undefined>,
): VueBadFilters {
  const gender = genderSchema.safeParse(one(params.genre));
  let ageMin = age(one(params.ageMin));
  let ageMax = age(one(params.ageMax));
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin];
  const zone = Number(one(params.quartier));
  const page = Number(one(params.page) ?? 1);
  return {
    gender: gender.success ? gender.data : null,
    ageMin,
    ageMax,
    zone: Number.isInteger(zone) && zone > 0 && zone <= 32767 ? zone : null,
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function vueBadQuery(filters: VueBadFilters, page = filters.page): string {
  const query = new URLSearchParams();
  if (filters.gender) query.set("genre", filters.gender);
  if (filters.ageMin !== null) query.set("ageMin", String(filters.ageMin));
  if (filters.ageMax !== null) query.set("ageMax", String(filters.ageMax));
  if (filters.zone !== null) query.set("quartier", String(filters.zone));
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `?${text}` : "";
}

const rowSchema = z.object({
  id: z.string(),
  pseudo: z.string(),
  gender: genderSchema,
  age: z.nullable(z.number()),
  city: z.nullable(z.string()),
  zone_name: z.nullable(z.string()),
  photo: z.nullable(photoSchema),
  motive: z.nullable(z.string()),
  tribes: z.array(tribeSchema),
  clean_record: z.boolean(),
  visits_honored: z.number(),
  visits_due: z.number(),
  total: z.number(),
});
export type VisitorPermit = z.infer<typeof rowSchema>;

/** The rows as the database gives them; a malformed one is left out. */
export function parseVisitorPermits(value: unknown): VisitorPermit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const parsed = rowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}
