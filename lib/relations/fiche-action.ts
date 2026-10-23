/**
 * What the bottom of a Fiche offers (owner's decision 2026-10-23, the placard Fiche). Only a
 * Visitor whose Permis is delivered, with no open request, no Affaire classée cooldown and an
 * open Parloir may bet and ask for a visit. A blocked pair never reaches the Fiche (404).
 */
export type FicheAction =
  | { kind: "self" }
  | { kind: "none" }
  | { kind: "request" }
  | { kind: "sent" }
  | { kind: "accepted" }
  | { kind: "released" }
  | { kind: "cooldown"; until: Date }
  | { kind: "full" }
  | { kind: "permit" };

export function ficheAction(input: {
  isSelf: boolean;
  role: "bad" | "visitor";
  requestStatus: string | null;
  cooldownUntil: string | null;
  requestsOpen: boolean;
  permitDelivered: boolean;
  now: Date;
}): FicheAction {
  if (input.isSelf) return { kind: "self" };
  if (input.role !== "visitor") return { kind: "none" };
  if (input.requestStatus === "pending") return { kind: "sent" };
  if (input.requestStatus === "accepted") return { kind: "accepted" };
  if (input.requestStatus === "released") return { kind: "released" };
  const until = input.cooldownUntil ? new Date(input.cooldownUntil) : null;
  if (until && until > input.now) return { kind: "cooldown", until };
  if (!input.requestsOpen) return { kind: "full" };
  if (!input.permitDelivered) return { kind: "permit" };
  return { kind: "request" };
}

/** The behaviour note on the placard: the start of the Bad's text, cut on a word. */
export function abridge(text: string, max = 110): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if ([...clean].length <= max) return clean;
  const cut = [...clean].slice(0, max).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.!?-]+$/, "")}…`;
}
