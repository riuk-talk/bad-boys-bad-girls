import { describe, expect, it } from "vitest";
import { abridge, ficheAction } from "@/lib/relations/fiche-action";

const now = new Date("2026-10-23T12:00:00Z");
const base = {
  isSelf: false,
  role: "visitor" as const,
  requestStatus: null,
  cooldownUntil: null,
  requestsOpen: true,
  permitDelivered: true,
  now,
};

describe("ficheAction", () => {
  it("lets a Visitor with a delivered Permis bet and ask", () => {
    expect(ficheAction(base)).toEqual({ kind: "request" });
  });

  it("the Bad's own Fiche, and a Bad on another Fiche, never offer a request", () => {
    expect(ficheAction({ ...base, isSelf: true })).toEqual({ kind: "self" });
    expect(ficheAction({ ...base, role: "bad" })).toEqual({ kind: "none" });
  });

  it("an open request comes first: sent, accepted, released", () => {
    expect(ficheAction({ ...base, requestStatus: "pending", requestsOpen: false })).toEqual({
      kind: "sent",
    });
    expect(ficheAction({ ...base, requestStatus: "accepted" }).kind).toBe("accepted");
    expect(ficheAction({ ...base, requestStatus: "released" }).kind).toBe("released");
  });

  it("then the cooldown of an Affaire classée, only while it runs", () => {
    const until = "2026-11-01T00:00:00Z";
    expect(ficheAction({ ...base, cooldownUntil: until })).toEqual({
      kind: "cooldown",
      until: new Date(until),
    });
    expect(ficheAction({ ...base, cooldownUntil: "2026-10-01T00:00:00Z" }).kind).toBe("request");
  });

  it("then a full Parloir, then a Permis not delivered yet", () => {
    expect(ficheAction({ ...base, requestsOpen: false, permitDelivered: false }).kind).toBe("full");
    expect(ficheAction({ ...base, permitDelivered: false }).kind).toBe("permit");
  });
});

describe("abridge", () => {
  it("keeps a short note as it is, spaces tidied", () => {
    expect(abridge("  Motarde,\n allergique  ")).toBe("Motarde, allergique");
  });

  it("cuts a long note on a word, with an ellipsis", () => {
    const text =
      "Motarde, allergique aux plans trop sages. Préfère une vraie conversation à cent messages tièdes, et la route.";
    const short = abridge(text, 60);
    expect(short.endsWith("…")).toBe(true);
    expect([...short].length).toBeLessThanOrEqual(61);
    expect(text.startsWith(short.slice(0, -1))).toBe(true);
  });
});

describe("agreeLabel", () => {
  it("agrees an inclusive French label with the gender of the person shown", async () => {
    const { agreeLabel } = await import("@/lib/relations/types");
    expect(agreeLabel("Tatoué·e", "man")).toBe("Tatoué");
    expect(agreeLabel("Tatoué·e", "woman")).toBe("Tatouée");
    expect(agreeLabel("Tatoué·e", "non_binary")).toBe("Tatoué·e");
    expect(agreeLabel("Tatoué·e", "other")).toBe("Tatoué·e");
    expect(agreeLabel("Rockeur·se", "woman")).toBe("Rockeuse");
    expect(agreeLabel("Voyageur·se", "man")).toBe("Voyageur");
    expect(agreeLabel("Fêtard·e", "woman")).toBe("Fêtarde");
    expect(agreeLabel("Créateur·rice", "woman")).toBe("Créatrice");
    expect(agreeLabel("Biker", "woman")).toBe("Biker");
    expect(agreeLabel("Tattooed", "woman")).toBe("Tattooed");
  });
});
