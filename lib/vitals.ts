/**
 * Real Core Web Vitals (SPEC §18, Phase 8b): each page view sends LCP, CLS and INP to
 * /api/vitals, which adds them to a daily histogram (no identifier, no IP, kept 90 days). The page
 * is reduced to its template (never an id, a N° d'écrou or a query string).
 */
export const VITAL_PAGES = [
  "landing",
  "promenade",
  "decouverte",
  "fiche",
  "courrier",
  "parloir",
  "other",
] as const;
export type VitalPage = (typeof VITAL_PAGES)[number];

export const VITAL_METRICS = ["LCP", "CLS", "INP"] as const;
export type VitalMetric = (typeof VITAL_METRICS)[number];

/** Thresholds of a « good » 75th percentile (SPEC §18). CLS is unitless, the others in ms. */
export const VITAL_GOOD: Record<VitalMetric, number> = { LCP: 2500, CLS: 0.1, INP: 200 };

export function vitalPage(pathname: string): VitalPage {
  const path = pathname.replace(/^\/(en|fr)(?=\/|$)/, "").replace(/\/+$/, "") || "/";
  if (path === "/") return "landing";
  if (path === "/promenade") return "promenade";
  if (path === "/decouverte") return "decouverte";
  if (/^\/fiche\/[^/]+$/.test(path)) return "fiche";
  if (path === "/courrier" || /^\/courrier\/[^/]+$/.test(path)) return "courrier";
  if (/^\/visites\/parloir\/[^/]+$/.test(path)) return "parloir";
  return "other";
}

export type Vital = { page: VitalPage; metric: VitalMetric; value: number };
