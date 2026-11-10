import { describe, expect, it } from "vitest";
import { emailWarning } from "@/lib/auth/email-typo";

describe("mistyped e-mail at sign-up (10d)", () => {
  it("suggests the common domain for a slip", () => {
    expect(emailWarning("lune@gmail.comj")).toEqual({
      kind: "suggestion",
      email: "lune@gmail.com",
    });
    expect(emailWarning("lune@hotmial.com")).toEqual({
      kind: "suggestion",
      email: "lune@hotmail.com",
    });
    expect(emailWarning("lune@gmail.fr")).toEqual({ kind: "suggestion", email: "lune@gmail.com" });
    expect(emailWarning(" Lune@GMAIL.CON ")).toEqual({
      kind: "suggestion",
      email: "lune@gmail.com",
    });
    expect(emailWarning("lune@outlok.fr")).toEqual({
      kind: "suggestion",
      email: "lune@outlook.fr",
    });
    expect(emailWarning("lune@wanadoo.fe")).toEqual({
      kind: "suggestion",
      email: "lune@wanadoo.fr",
    });
  });

  it("warns about an unknown extension without guessing", () => {
    expect(emailWarning("lune@mondomaine.zzq")).toEqual({ kind: "unknown_tld" });
  });

  it("leaves right addresses alone", () => {
    for (const email of [
      "lune@gmail.com",
      "lune@orange.fr",
      "lune@yahoo.de",
      "lune@gmx.de",
      "lune@live.be",
      "lune@ma-societe.fr",
      "lune@laposte.net",
      "lune@etu.univ-tln.fr",
      "lune@proton.me",
    ]) {
      expect(emailWarning(email)).toBe(null);
    }
    expect(emailWarning("not an address")).toBe(null);
    expect(emailWarning("lune@")).toBe(null);
  });
});
