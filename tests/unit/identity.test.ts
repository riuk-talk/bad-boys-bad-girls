import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "@/lib/admin/nav";
import {
  correctionSchema,
  decisionSchema,
  genderChangeSchema,
  placeChangeSchema,
  pseudoChangeSchema,
} from "@/lib/validation/identity";

const years = (n: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
};

describe("« Mon identité » (10e): the rules of the sign-up, field by field", () => {
  it("pseudo: 3 to 20 letters, digits, space, dot, hyphen or underscore", () => {
    expect(pseudoChangeSchema.safeParse({ pseudo: " Lune Rousse " }).data?.pseudo).toBe(
      "Lune Rousse",
    );
    expect(pseudoChangeSchema.safeParse({ pseudo: "ab" }).success).toBe(false);
    expect(pseudoChangeSchema.safeParse({ pseudo: "lune@mail" }).success).toBe(false);
    expect(pseudoChangeSchema.safeParse({ pseudo: "x".repeat(21) }).success).toBe(false);
  });

  it("gender and town as at sign-up; « Enregistrer quand même » only as « 1 »", () => {
    expect(genderChangeSchema.safeParse({ gender: "non_binary" }).success).toBe(true);
    expect(genderChangeSchema.safeParse({ gender: "robot" }).success).toBe(false);
    expect(placeChangeSchema.safeParse({ placeId: "42" }).data).toEqual({ placeId: 42 });
    expect(placeChangeSchema.safeParse({ placeId: "42", confirm: "1" }).success).toBe(true);
    expect(placeChangeSchema.safeParse({ placeId: "42", confirm: "yes" }).success).toBe(false);
    expect(placeChangeSchema.safeParse({ placeId: "" }).success).toBe(false);
  });

  it("a correction of the date of birth: 18 or more, a real date, a short motive", () => {
    expect(correctionSchema.safeParse({ birthdate: years(30), reason: "Erreur" }).success).toBe(
      true,
    );
    const minor = correctionSchema.safeParse({ birthdate: years(17), reason: "Erreur" });
    expect(minor.error?.issues[0]?.message).toBe("underage");
    expect(correctionSchema.safeParse({ birthdate: "1990-02-30", reason: "Erreur" }).success).toBe(
      false,
    );
    expect(correctionSchema.safeParse({ birthdate: years(30), reason: " a " }).success).toBe(false);
    expect(
      correctionSchema.safeParse({ birthdate: years(30), reason: "x".repeat(201) }).success,
    ).toBe(false);
  });

  it("the Greffe's decision", () => {
    expect(decisionSchema.safeParse({ correction: "3", decision: "accept" }).success).toBe(true);
    expect(decisionSchema.safeParse({ correction: "3", decision: "maybe" }).success).toBe(false);
    expect(decisionSchema.safeParse({ correction: "-1", decision: "refuse" }).success).toBe(false);
  });

  it("the corrections have their page in the admin menu, under the accounts", () => {
    const accounts = ADMIN_NAV.find((group) => group.key === "accounts");
    expect(accounts?.items.map((item) => item.href)).toContain("/admin/corrections");
  });
});
