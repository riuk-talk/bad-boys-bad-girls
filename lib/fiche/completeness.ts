/**
 * "Fiche complète à X %" gauge (SPEC §4). Phase 2 criteria; Phase 3 adds the Casier and the
 * 20 questions with their own weights. Each criterion is an i18n key under "MyFiche.criteria".
 */
export type FicheFacts = {
  mainPhoto: "missing" | "pending" | "approved" | "rejected";
  photoCount: number;
  bioLength: number;
  signCount: number;
};

export const CRITERIA = [
  { key: "mainPhoto", weight: 40, done: (f: FicheFacts) => f.mainPhoto === "approved" },
  { key: "bio", weight: 20, done: (f: FicheFacts) => f.bioLength >= 40 },
  { key: "signs", weight: 20, done: (f: FicheFacts) => f.signCount >= 1 },
  { key: "morePhotos", weight: 20, done: (f: FicheFacts) => f.photoCount >= 3 },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];

export function completeness(facts: FicheFacts): { percent: number; missing: CriterionKey[] } {
  const total = CRITERIA.reduce((sum, c) => sum + c.weight, 0);
  const done = CRITERIA.filter((c) => c.done(facts));
  return {
    percent: Math.round((done.reduce((sum, c) => sum + c.weight, 0) / total) * 100),
    missing: CRITERIA.filter((c) => !c.done(facts)).map((c) => c.key),
  };
}

/** Age in full years from an ISO date (display only; the database enforces 18+). */
export function ageFromBirthdate(birthdate: string, today = new Date()): number {
  const [y, m, d] = birthdate.split("-").map(Number) as [number, number, number];
  const beforeBirthday =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  return today.getUTCFullYear() - y - (beforeBirthday ? 1 : 0);
}
