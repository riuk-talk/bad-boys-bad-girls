/** Le Casier (SPEC §6): pure rules shared by the assistant, the preview and the tests. */

export const CHARGE_MAX = 120;
/** Below this length, a line is too vague to be a fact: advice, never blocking (SPEC §6). */
export const CHARGE_SHORT_ADVICE = 25;

/** Length in characters as a reader counts them (not UTF-16 units). */
export function chargeLength(value: string): number {
  return Array.from(value.trim()).length;
}

/** Comparison key: lower case, no whitespace. Mirror of public.charge_key (SQL). */
export function chargeKey(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

/** Indexes (0–2) of lines that repeat another one, ignoring case and spaces. */
export function duplicateIndexes(lines: readonly string[]): number[] {
  const keys = lines.map(chargeKey);
  return keys.flatMap((key, index) =>
    key.length > 0 && keys.some((other, j) => j !== index && other === key) ? [index] : [],
  );
}

export type Balance = "long" | "short" | null;

/**
 * « Teste ton Casier » (rule validated 2026-10-05): each line is compared with the mean length of
 * the two others; more than 40 % longer → "long", more than 40 % shorter → "short". Exactly 40 %
 * does not warn. Integer arithmetic: 10 × len > 7 × (a + b) is len > 1.4 × mean(a, b).
 */
export function balance(lines: readonly [string, string, string]): [Balance, Balance, Balance] {
  const lengths = lines.map(chargeLength);
  return lengths.map((length, index) => {
    const others = lengths.reduce((sum, value, j) => (j === index ? sum : sum + value), 0);
    if (others === 0) return null;
    if (10 * length > 7 * others) return "long";
    if (10 * length < 3 * others) return "short";
    return null;
  }) as [Balance, Balance, Balance];
}

/** Random order for the Visitors, keeping track of the true line (1–3, as stored in SQL). */
export function shuffleCharges(
  trueLine: string,
  falseLines: readonly [string, string],
  random: () => number = Math.random,
): { charges: [string, string, string]; trueIndex: 1 | 2 | 3 } {
  const items = [
    { text: trueLine, isTrue: true },
    { text: falseLines[0], isTrue: false },
    { text: falseLines[1], isTrue: false },
  ];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return {
    charges: items.map((item) => item.text) as [string, string, string],
    trueIndex: (items.findIndex((item) => item.isTrue) + 1) as 1 | 2 | 3,
  };
}

/** A generic formula advised against (SPEC §6 [P1], table casier_cliches). */
export type Cliche = { phrase: string; needs_detail: boolean };

/** Below this many letters around a `needs_detail` formula, the line says nothing more. */
export const CLICHE_DETAIL_LETTERS = 12;

/** Lower case, no accents, œ/æ spelled out, every non-letter a single space. */
export function clicheKey(value: string): string {
  return ` ${value
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

/**
 * Whether a line rests on a cliché: the formula appears from the start of a word (« vol de cœur »
 * also catches « vol de cœurs »); a `needs_detail` one only when the rest of the line is too thin.
 */
export function isCliche(line: string, cliches: readonly Cliche[]): boolean {
  const key = clicheKey(line);
  return cliches.some(({ phrase, needs_detail }) => {
    const formula = clicheKey(phrase).trimEnd();
    const at = key.indexOf(formula);
    if (formula.trim().length === 0 || at < 0) return false;
    if (!needs_detail) return true;
    const rest = (key.slice(0, at) + key.slice(at + formula.length)).replace(/[^\p{L}]/gu, "");
    return rest.length < CLICHE_DETAIL_LETTERS;
  });
}
