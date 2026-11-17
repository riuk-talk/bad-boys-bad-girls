import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { parseVisitorPermits, parseVueBadFilters, vueBadQuery } from "@/lib/admin/vue-bad";

const row = {
  id: "2b0c0000-0000-4000-8000-000000000000",
  pseudo: "Nox",
  gender: "man",
  age: 34,
  city: "Toulon",
  zone_name: "Toulon",
  photo: { position: 0, large: "a.webp", small: "a-s.webp", cutout: true, waived: false },
  motive: "Je préfère une route de montagne.",
  tribes: [{ label: { fr: "Biker", en: "Biker" }, detail: null }],
  clean_record: true,
  visits_honored: 2,
  visits_due: 2,
  total: 1,
};

describe("« Voir comme un Bad » (10f-bis)", () => {
  it("reads the filters of the page, anything unknown is no filter", () => {
    expect(
      parseVueBadFilters({ genre: "woman", ageMin: "40", ageMax: "30", quartier: "2", page: "3" }),
    ).toEqual({
      gender: "woman",
      ageMin: 30,
      ageMax: 40,
      zone: 2,
      page: 3,
    });
    expect(parseVueBadFilters({ genre: "robot", ageMin: "12", quartier: "x", page: "0" })).toEqual({
      gender: null,
      ageMin: null,
      ageMax: null,
      zone: null,
      page: 1,
    });
    expect(vueBadQuery(parseVueBadFilters({ genre: "man", quartier: "1" }), 2)).toBe(
      "?genre=man&quartier=1&page=2",
    );
  });

  it("shows the Permis as the Courrier does, never the Visitor's criteria", () => {
    const [permit] = parseVisitorPermits([row, { ...row, gender: "robot" }]);
    expect(parseVisitorPermits([row, { ...row, gender: "robot" }])).toHaveLength(1);
    expect(permit).not.toHaveProperty("seeking_genders");
    expect(parseVisitorPermits({ ...row, seeking_genders: ["woman"] })).toEqual([]);
    const [withCriteria] = parseVisitorPermits([
      { ...row, seeking_genders: ["woman"], seek_age_min: 25 },
    ]);
    expect(withCriteria).not.toHaveProperty("seeking_genders");
    expect(withCriteria).not.toHaveProperty("seek_age_min");
  });

  it("sits in the tools, beside « Voir comme un Visiteur », with its own permission", () => {
    const tools = ADMIN_NAV.find((group) => group.key === "tools");
    expect(tools?.items.map((item) => item.href)).toEqual([
      "/admin/vue",
      "/admin/vue-bad",
      "/admin/performance",
    ]);
    expect(tools?.items[1]).toMatchObject({ permission: "vue_bad.view", highlight: true });
  });
});
