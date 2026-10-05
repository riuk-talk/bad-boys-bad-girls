/**
 * Indice de complicité (SPEC §9). Pure mirror of the SQL function `public.complicity_score`;
 * both are checked against the same cases (tests/fixtures/complicity-cases.json).
 */

export type Importance = "low" | "important" | "essential";

export const IMPORTANCE_WEIGHTS: Record<Importance, number> = {
  low: 1,
  important: 10,
  essential: 50,
};

/** Below this number of questions answered by both, there is no score. */
export const MIN_COMMON_QUESTIONS = 5;

/** An unmet "essential" question, in either direction, caps the score at this value. */
export const ESSENTIAL_CAP = 50;

export interface Answer {
  questionId: number;
  optionId: number;
  /** Options accepted from the other person; null = all of them. */
  accepted: readonly number[] | null;
  importance: Importance;
}

export interface Complicity {
  /** Percentage 0–100, or null when fewer than MIN_COMMON_QUESTIONS are shared. */
  score: number | null;
  commonCount: number;
  /** True when an "essential" question is unmet in either direction (only when a score exists). */
  capped: boolean;
}

function accepts(answer: Answer, otherOptionId: number): boolean {
  return answer.accepted === null || answer.accepted.includes(otherOptionId);
}

/**
 * round(100 × sqrt(nA/dA × nB/dB)), halves rounded up, computed in exact integers like the SQL:
 * the largest s with (2s − 1)² × dA × dB ≤ 4 × 100² × nA × nB. Float rounding never decides.
 */
function roundedPercentSqrt(nA: number, dA: number, nB: number, dB: number): number {
  const p = 40000 * nA * nB;
  const q = dA * dB;
  let s = Math.round(100 * Math.sqrt((nA * nB) / q));
  while (s > 0 && (2 * s - 1) * (2 * s - 1) * q > p) s -= 1;
  while ((2 * s + 1) * (2 * s + 1) * q <= p) s += 1;
  return s;
}

/** Answers must be those of active questions only, at most one per question for each person. */
export function complicityScore(a: readonly Answer[], b: readonly Answer[]): Complicity {
  const byQuestion = new Map(b.map((answer) => [answer.questionId, answer]));
  let commonCount = 0;
  let nA = 0;
  let dA = 0;
  let nB = 0;
  let dB = 0;
  let capped = false;

  for (const answerA of a) {
    const answerB = byQuestion.get(answerA.questionId);
    if (!answerB) continue;
    commonCount += 1;
    const wA = IMPORTANCE_WEIGHTS[answerA.importance];
    const wB = IMPORTANCE_WEIGHTS[answerB.importance];
    const aSatisfied = accepts(answerA, answerB.optionId);
    const bSatisfied = accepts(answerB, answerA.optionId);
    dA += wA;
    dB += wB;
    if (aSatisfied) nA += wA;
    if (bSatisfied) nB += wB;
    if (
      (answerA.importance === "essential" && !aSatisfied) ||
      (answerB.importance === "essential" && !bSatisfied)
    ) {
      capped = true;
    }
  }

  if (commonCount < MIN_COMMON_QUESTIONS) return { score: null, commonCount, capped: false };
  const raw = roundedPercentSqrt(nA, dA, nB, dB);
  return { score: capped ? Math.min(raw, ESSENTIAL_CAP) : raw, commonCount, capped };
}
