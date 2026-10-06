/**
 * Le Souffleur (SPEC §8): three opening lines for a Demande de parloir, from sentence templates
 * only (no AI, no API). Inputs are the common answers of the Interrogatoire and the shared
 * distinctive signs. The Casier never enters here: a hook can never quote the chosen charge
 * (rule 14: the note is read by the Bad before the visit).
 */

/** Below this number of questions answered by both, common answers are not used (SPEC §8). */
export const MIN_COMMON_FOR_POINTS = 5;

export type HookKind = "common" | "tribe" | "casier" | "generic";

/** Sentence templates by kind (messages « Prompter », FR and EN). */
export type PrompterTemplates = Record<HookKind, readonly string[]>;

/** The only placeholders a template may use. A charge of the Casier is never one of them. */
export const PLACEHOLDERS = ["question", "answer", "tribe"] as const;

export type PrompterInput = {
  /** Identical answers of both members, localized, best first (common_points). */
  commonPoints: readonly { question: string; answer: string }[];
  /** Number of questions answered by both (common_count of the complicity score). */
  commonCount: number;
  /** Labels of the distinctive signs both members share, localized. */
  sharedTribes: readonly string[];
};

export type Hook = { kind: HookKind; template: number; text: string };

/** The three slots of the Demande de parloir, in display order. */
export const SLOTS = ["common", "tribe", "casier"] as const;
export type Slot = (typeof SLOTS)[number];

type Random = () => number;

export function fill(
  template: string,
  values: Partial<Record<(typeof PLACEHOLDERS)[number], string>>,
) {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? (values[key as keyof typeof values] ?? whole) : whole,
  );
}

/** A random index in [0, length), never `avoid` when there is another choice. */
export function pickIndex(length: number, random: Random, avoid: readonly number[] = []): number {
  const allowed = Array.from({ length }, (_, index) => index).filter(
    (index) => !avoid.includes(index),
  );
  const pool = allowed.length > 0 ? allowed : Array.from({ length }, (_, index) => index);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? 0;
}

/** Which kind of hook a slot can offer with the data available. */
export function kindForSlot(slot: Slot, input: PrompterInput): HookKind {
  if (slot === "common") {
    return input.commonCount >= MIN_COMMON_FOR_POINTS && input.commonPoints.length > 0
      ? "common"
      : "generic";
  }
  if (slot === "tribe") return input.sharedTribes.length > 0 ? "tribe" : "generic";
  return "casier";
}

/**
 * One hook for a slot. `previous` is the hook shown before in this slot (« Autre idée »): the same
 * template never comes twice in a row. `taken` are generic templates already shown in other slots.
 */
export function suggestHook(
  slot: Slot,
  input: PrompterInput,
  templates: PrompterTemplates,
  options: { previous?: Hook; taken?: readonly number[]; random?: Random } = {},
): Hook {
  const random = options.random ?? Math.random;
  const kind = kindForSlot(slot, input);
  const list = templates[kind];
  const avoid = [
    ...(options.previous?.kind === kind ? [options.previous.template] : []),
    ...(kind === "generic" ? (options.taken ?? []) : []),
  ];
  const template = pickIndex(list.length, random, avoid);
  const raw = list[template] ?? "";
  if (kind === "common") {
    const point = input.commonPoints[pickIndex(input.commonPoints.length, random)];
    return {
      kind,
      template,
      text: fill(raw, { question: point?.question, answer: point?.answer }),
    };
  }
  if (kind === "tribe") {
    const tribe = input.sharedTribes[pickIndex(input.sharedTribes.length, random)];
    return { kind, template, text: fill(raw, { tribe }) };
  }
  return { kind, template, text: raw };
}

/** The three hooks of the modal; two generic slots never show the same template. */
export function suggestHooks(
  input: PrompterInput,
  templates: PrompterTemplates,
  random: Random = Math.random,
): Hook[] {
  const hooks: Hook[] = [];
  for (const slot of SLOTS) {
    const taken = hooks.filter((hook) => hook.kind === "generic").map((hook) => hook.template);
    hooks.push(suggestHook(slot, input, templates, { taken, random }));
  }
  return hooks;
}

/** Common distinctive signs, compared on their French label (stable across locales). */
export function sharedTribeLabels(
  mine: readonly { label: { fr?: string; en?: string } }[],
  theirs: readonly { label: { fr?: string; en?: string } }[],
  locale: string,
): string[] {
  const own = new Set(mine.map((tribe) => tribe.label.fr));
  return theirs
    .filter((tribe) => own.has(tribe.label.fr))
    .map((tribe) => (locale === "en" ? tribe.label.en : tribe.label.fr) ?? tribe.label.fr ?? "")
    .filter(Boolean);
}
