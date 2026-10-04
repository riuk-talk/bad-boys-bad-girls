import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

function shape(value: unknown, path = ""): string[] {
  if (Array.isArray(value))
    return [`${path}[${value.length}]`, ...value.flatMap((v, i) => shape(v, `${path}[${i}]`))];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, v]) => shape(v, path ? `${path}.${key}` : key));
  }
  return [path];
}

/** Every displayed string, without the keys (technical names such as "judgeTitle" may stay). */
function values(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === "object") return Object.values(value).flatMap(values);
  return [];
}

describe("messages", () => {
  it("fr and en have exactly the same keys", () => {
    expect(shape(en).sort()).toEqual(shape(fr).sort());
  });

  it("no UI string uses forbidden product vocabulary (match, swipe, like)", () => {
    // Allowed: "like" inside other words, e.g. "likely". Checked on the French UI only.
    const text = JSON.stringify(fr).toLowerCase();
    expect(text).not.toMatch(/\b(match|matchs|swipe|swiper|like|likes)\b/);
  });

  it("no UI string uses vocabulary retired in SPEC v7 (Plaidoirie, Réglo, Audience, Libération, aveux, juge)", () => {
    // "audience" stays allowed in the privacy policy ("mesure d'audience" = web analytics).
    const text = values(fr).join("\n").toLowerCase().replaceAll("mesure d'audience", "");
    expect(text).not.toMatch(/plaid|plaide[rz]?\b|réglo|audience|coupables tous les deux/);
    // docs/LANDING-COPY.md: no "Libération" (the Parloir is where people talk; the Permis becomes
    // permanent) and no "aveux" (a false charge is not a confession).
    expect(text).not.toMatch(/libér|aveu|devine[rz]? (le|lequel)/);
    // Correction n° 2: the Bad is not a judge; the principle is "rien ne se fait sans ton accord".
    expect(text).not.toMatch(/\bjuges?\b/);
    const english = values(en).join("\n").toLowerCase();
    expect(english).not.toMatch(/\bplead|\bpleas?\b|\blegit\b|evening hearing|both guilty/);
    expect(english).not.toMatch(/releas|confession|guess which/);
    expect(english).not.toMatch(/\bjudges?\b/);
  });
});

const ROOT = join(__dirname, "..", "..");
const SCANNED_DIRS = ["app", "components"];
const TEXT_ATTRIBUTES = new Set([
  "alt",
  "title",
  "placeholder",
  "aria-label",
  "label",
  "hint",
  "error",
]);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

function hardcodedStrings(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && /\p{L}/u.test(node.text)) found.push(node.text.trim());
    if (
      ts.isJsxAttribute(node) &&
      TEXT_ATTRIBUTES.has(node.name.getText()) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      /\p{L}/u.test(node.initializer.text)
    ) {
      found.push(`${node.name.getText()}="${node.initializer.text}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("no hard-coded UI strings", () => {
  it("JSX text and text attributes come from next-intl", () => {
    const offenders = SCANNED_DIRS.flatMap((dir) => tsxFiles(join(ROOT, dir))).flatMap((file) =>
      hardcodedStrings(file).map((text) => `${relative(ROOT, file)}: ${text}`),
    );
    expect(offenders).toEqual([]);
  });
});
