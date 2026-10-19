import { describe, expect, it } from "vitest";
import { cavaleTimeError, datesSchema, looksPrivatePlace } from "@/lib/cavale";

describe("looksPrivatePlace (mirror of public.looks_private_place)", () => {
  it("warns for a home or an address", () => {
    for (const text of [
      "chez moi",
      "Chez toi, après le concert",
      "à la maison",
      "My place",
      "3bis avenue Foch",
      "12 rue des Lilas",
      "mon appart",
    ]) {
      expect(looksPrivatePlace(text), text).toBe(true);
    }
  });

  it("not for a public place", () => {
    for (const text of [
      "Bar le 12",
      "Chez Léon, bistrot",
      "Le Zinc",
      "Café de la Plage",
      "Concert au Zénith",
    ]) {
      expect(looksPrivatePlace(text), text).toBe(false);
    }
  });
});

describe("cavaleTimeError", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  it("at least 1 h ahead, within 60 days", () => {
    expect(cavaleTimeError(new Date("2026-10-20T10:30:00Z"), now)).toBe("too_soon");
    expect(cavaleTimeError(new Date("2026-10-20T11:00:00Z"), now)).toBeNull();
    expect(cavaleTimeError(new Date("2026-12-20T11:00:00Z"), now)).toBe("too_far");
  });
});

describe("datesSchema", () => {
  it("reads get_dates", () => {
    const card = {
      id: "d",
      venue_type: "bar",
      venue_name: "Le Zinc",
      starts_at: "2026-10-21T19:00:00Z",
      private_place_warning: false,
      mine: true,
    };
    expect(
      datesSchema.safeParse({ pending: null, accepted: card, wait_until: null, can_propose: false })
        .success,
    ).toBe(true);
    expect(
      datesSchema.safeParse({
        pending: { ...card, countered: true },
        accepted: null,
        wait_until: "2026-10-21T10:00:00Z",
        can_propose: false,
      }).success,
    ).toBe(true);
    expect(
      datesSchema.safeParse({
        pending: { ...card, venue_type: "home" },
        accepted: null,
        wait_until: null,
        can_propose: true,
      }).success,
    ).toBe(false);
  });
});
