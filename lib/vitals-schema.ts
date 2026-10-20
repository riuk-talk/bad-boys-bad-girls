import * as z from "zod/mini";
import { VITAL_METRICS, VITAL_PAGES } from "./vitals";

// Validation of /api/vitals, server side: zod stays out of the client bundle of lib/vitals.

/** Upper bounds of an acceptable value: anything beyond is a broken measure, not a slow page. */
const MAX_VALUE: Record<(typeof VITAL_METRICS)[number], number> = {
  LCP: 60_000,
  CLS: 10,
  INP: 60_000,
};

export const vitalSchema = z.object({
  page: z.enum(VITAL_PAGES),
  metric: z.enum(VITAL_METRICS),
  value: z.number().check(z.gte(0)),
});
export const vitalBatchSchema = z.array(vitalSchema).check(z.minLength(1), z.maxLength(3));

export function isPlausible(vital: z.infer<typeof vitalSchema>): boolean {
  return Number.isFinite(vital.value) && vital.value <= MAX_VALUE[vital.metric];
}
