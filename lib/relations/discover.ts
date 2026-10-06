import * as z from "zod/mini";

/** Filters of the Découverte (SPEC §12 bis), read from the query string (GET form, no JS). */
export const DISTANCES = [10, 25, 50, 100] as const;
export const PAGE_SIZE = 24;

/** An integer within bounds, or undefined (an invalid value is ignored, not an error). */
function boundedInt(value: unknown, min: number, max: number): number | undefined {
  const number = typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(number) && number >= min && number <= max ? number : undefined;
}

const searchSchema = z.object({
  ageMin: z.optional(z.unknown()),
  ageMax: z.optional(z.unknown()),
  km: z.optional(z.unknown()),
  tribe: z.optional(z.union([z.string(), z.array(z.string())])),
  conduct: z.optional(z.string()),
  active: z.optional(z.string()),
  after: z.optional(z.string()),
});

export type DiscoverFilters = {
  ageMin: number;
  ageMax: number;
  km: number | null;
  tribes: number[];
  goodConductOnly: boolean;
  recentlyActive: boolean;
  cursor: { key: number; id: string } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDiscoverFilters(
  params: Record<string, string | string[] | undefined>,
): DiscoverFilters {
  const parsed = searchSchema.safeParse(params);
  const data = parsed.success ? parsed.data : {};
  const ageMin = boundedInt(data.ageMin, 18, 99) ?? 18;
  const ageMax = Math.max(boundedInt(data.ageMax, 18, 99) ?? 99, ageMin);
  const tribes = (Array.isArray(data.tribe) ? data.tribe : data.tribe ? [data.tribe] : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0 && id < 1000)
    .slice(0, 20);
  const [key, id] = (data.after ?? "").split("_");
  const cursorKey = Number(key);
  return {
    ageMin,
    ageMax,
    km: boundedInt(data.km, 1, 500) ?? null,
    tribes: [...new Set(tribes)],
    goodConductOnly: data.conduct === "1",
    recentlyActive: data.active === "1",
    cursor: Number.isSafeInteger(cursorKey) && id && UUID.test(id) ? { key: cursorKey, id } : null,
  };
}

/** Query string of the same filters, for the « next page » link. */
export function filtersQuery(filters: DiscoverFilters, after?: { key: number; id: string }) {
  const query = new URLSearchParams();
  if (filters.ageMin !== 18) query.set("ageMin", String(filters.ageMin));
  if (filters.ageMax !== 99) query.set("ageMax", String(filters.ageMax));
  if (filters.km) query.set("km", String(filters.km));
  for (const tribe of filters.tribes) query.append("tribe", String(tribe));
  if (filters.goodConductOnly) query.set("conduct", "1");
  if (filters.recentlyActive) query.set("active", "1");
  if (after) query.set("after", `${after.key}_${after.id}`);
  const text = query.toString();
  return text ? `?${text}` : "";
}
