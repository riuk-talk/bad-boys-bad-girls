import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import {
  fill,
  MIN_COMMON_FOR_POINTS,
  pickIndex,
  PLACEHOLDERS,
  type PrompterInput,
  type PrompterTemplates,
  sharedTribeLabels,
  suggestHook,
  suggestHooks,
} from "@/lib/prompter";

const LOCALES = { fr: fr.Prompter, en: en.Prompter } as Record<string, PrompterTemplates>;
const KINDS = ["common", "tribe", "casier", "generic"] as const;

/** Deterministic random sequence. */
function sequence(values: number[]) {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

const full: PrompterInput = {
  commonPoints: [
    { question: "Ta soirée idéale ?", answer: "Concert" },
    { question: "Chat ou chien ?", answer: "Chat" },
  ],
  commonCount: 8,
  sharedTribes: ["Biker"],
};

describe("Souffleur templates (SPEC §8)", () => {
  for (const [locale, templates] of Object.entries(LOCALES)) {
    for (const kind of KINDS) {
      it(`${locale}/${kind}: at least 10 distinct templates`, () => {
        expect(templates[kind].length).toBeGreaterThanOrEqual(10);
        expect(new Set(templates[kind]).size).toBe(templates[kind].length);
      });
    }

    it(`${locale}: only the allowed placeholders, and each kind uses its own`, () => {
      for (const kind of KINDS) {
        for (const template of templates[kind]) {
          const used = [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
          for (const name of used) expect(PLACEHOLDERS).toContain(name);
          if (kind === "common")
            expect(used).toEqual(expect.arrayContaining(["question", "answer"]));
          if (kind === "tribe") expect(used).toContain("tribe");
          if (kind === "casier" || kind === "generic") expect(used).toEqual([]);
        }
      }
    });

    it(`${locale}: no template points at one line of the Casier`, () => {
      const lineReference =
        /\b(premi(er|ère)|deuxième|second|troisième|dernier chef|1er|n°|ligne|first|third|line)\b|\b[123]\b(?!\s*(lignes|lines))/i;
      for (const kind of ["casier", "generic"] as const) {
        for (const template of templates[kind]) expect(template).not.toMatch(lineReference);
      }
    });
  }

  it("fr and en have the same number of templates per kind", () => {
    for (const kind of KINDS) expect(LOCALES.en?.[kind].length).toBe(LOCALES.fr?.[kind].length);
  });
});

describe("Souffleur hooks", () => {
  const templates = LOCALES.fr as PrompterTemplates;

  it("three hooks: a common answer, a shared sign, the Casier", () => {
    const hooks = suggestHooks(full, templates, sequence([0.1, 0.5, 0.9]));
    expect(hooks.map((hook) => hook.kind)).toEqual(["common", "tribe", "casier"]);
    expect(hooks[0]?.text).toMatch(/Concert|Chat/);
    expect(hooks[1]?.text).toContain("Biker");
    for (const hook of hooks) expect(hook.text).not.toMatch(/\{\w+\}/);
  });

  it(`fewer than ${MIN_COMMON_FOR_POINTS} common questions: generic hooks, never a common answer`, () => {
    const poor = { ...full, commonCount: MIN_COMMON_FOR_POINTS - 1, sharedTribes: [] };
    for (let run = 0; run < 50; run++) {
      const hooks = suggestHooks(poor, templates);
      expect(hooks.map((hook) => hook.kind)).toEqual(["generic", "generic", "casier"]);
      expect(hooks[0]?.template).not.toBe(hooks[1]?.template);
      for (const hook of hooks) expect(hook.text).not.toMatch(/Concert|Chat/);
    }
  });

  it("« Autre idée » never shows the same template twice in a row", () => {
    for (const slot of ["common", "tribe", "casier"] as const) {
      let previous = suggestHook(slot, full, templates);
      for (let run = 0; run < 200; run++) {
        const next = suggestHook(slot, full, templates, { previous });
        expect(next.template).not.toBe(previous.template);
        previous = next;
      }
    }
  });

  it("no hook ever quotes the Casier: the Souffleur has no access to it", () => {
    const charges = ["A traversé la Manche en kayak", "A dormi dans un phare", "A volé une cloche"];
    // Even an input carrying the charges by mistake cannot reach a template.
    const polluted = { ...full, charges, guessedIndex: 2 } as PrompterInput;
    for (let run = 0; run < 200; run++) {
      for (const hook of suggestHooks(polluted, templates)) {
        for (const charge of charges) expect(hook.text).not.toContain(charge);
      }
    }
  });

  it("pickIndex covers every index and avoids the given ones", () => {
    const seen = new Set<number>();
    for (let value = 0; value < 1; value += 0.01) seen.add(pickIndex(5, () => value, [2]));
    expect([...seen].sort()).toEqual([0, 1, 3, 4]);
    expect(pickIndex(1, () => 0.7, [0])).toBe(0);
  });

  it("fill leaves unknown placeholders untouched", () => {
    expect(fill("{tribe} et {other}", { tribe: "Biker" })).toBe("Biker et {other}");
  });

  it("shared distinctive signs, localized", () => {
    const mine = [
      { label: { fr: "Tatoué·e", en: "Tattooed" } },
      { label: { fr: "Biker", en: "Biker" } },
    ];
    const theirs = [
      { label: { fr: "Tatoué·e", en: "Tattooed" } },
      { label: { fr: "Noctambule", en: "Night owl" } },
    ];
    expect(sharedTribeLabels(mine, theirs, "fr")).toEqual(["Tatoué·e"]);
    expect(sharedTribeLabels(mine, theirs, "en")).toEqual(["Tattooed"]);
  });
});
