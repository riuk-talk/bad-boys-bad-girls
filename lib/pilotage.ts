import * as z from "zod/mini";

/** Le pilotage (SPEC §3, §15): shapes of what Postgres returns, and the small computations shown. */

const ERROR_KEYS = [
  "invalid_name",
  "invalid_slug",
  "invalid_place",
  "invalid_timezone",
  "invalid_thresholds",
  "slug_taken",
  "same_status",
  "super_admin_only",
  "invalid_label",
  "invalid_term",
  "invalid_keyword",
  "keyword_taken",
  "core_question",
  "invalid_options",
  "invalid_period",
  "not_found",
] as const;
export type PilotageError =
  (typeof ERROR_KEYS)[number] | "ambiguous_place" | "invalid_form" | "generic";

export function pilotageErrorKey(message: string | undefined): PilotageError {
  return ERROR_KEYS.find((key) => message === key) ?? "generic";
}

export function isPilotageError(value: string | undefined): value is PilotageError {
  return (
    value === "ambiguous_place" ||
    value === "invalid_form" ||
    value === "generic" ||
    ERROR_KEYS.some((key) => key === value)
  );
}

export const gaugeSchema = z.object({
  bads: z.number(),
  threshold_bads: z.number(),
  bad_girls: z.number(),
  min_bad_girls: z.number(),
  bad_boys: z.number(),
  min_bad_boys: z.number(),
  visitors_waiting: z.number(),
  ready: z.boolean(),
});
export type Gauge = z.infer<typeof gaugeSchema>;

const count = z.number();
const hours = z.nullable(z.number());

export const healthSchema = z.object({
  period: z.object({ from: z.string(), to: z.string(), days: count }),
  gauge: gaugeSchema,
  members: z.object({
    signed_up: count,
    by_role_gender: z.record(z.string(), count),
    complete: z.object({ dossiers: count, permits: count }),
  }),
  requests: z.object({
    sent: count,
    per_day: z.number(),
    auto_closed: count,
    decided: count,
    accepted: count,
    accepted_right_bet: count,
    decided_right_bet: count,
    accepted_wrong_bet: count,
    decided_wrong_bet: count,
    avg_response_hours: hours,
    with_visit: count,
    slots_declined: count,
  }),
  visits: z.object({
    started: count,
    bad_present: count,
    visitor_present: count,
    both_present: count,
    released: count,
    late_cancellations: count,
  }),
  cavales: z.object({ proposed: count, accepted: count }),
  promenade: z.object({ visitor_days: count, under_five: count }),
  retention: z.nullable(
    z.record(
      z.string(),
      z.object({ cohort_d7: count, back_d7: count, cohort_d30: count, back_d30: count }),
    ),
  ),
  moderation: z.object({
    reports: count,
    avg_report_hours: hours,
    photos_reviewed: count,
    avg_greffe_hours: hours,
  }),
  push: z.object({ members: count, subscribed: count, sent: count, failed: count }),
});
export type Health = z.infer<typeof healthSchema>;

/** A share in whole percent, or null when there is nothing to divide (shown as « — »). */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** A day (YYYY-MM-DD) in Paris, `offset` days from `now`. */
export function parisDay(now: Date, offset = 0): string {
  const day = new Date(now.getTime() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(day);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The period asked in the address bar, or the last 30 days; never more than a year. */
export function healthPeriod(
  from: string | undefined,
  to: string | undefined,
  now: Date,
): { from: string; to: string } {
  const end = to && DAY.test(to) ? to : parisDay(now);
  const start = from && DAY.test(from) ? from : parisDay(now, -29);
  const span = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  if (Number.isNaN(span) || span < 0 || span > 366)
    return { from: parisDay(now, -29), to: parisDay(now) };
  return { from: start, to: end };
}
