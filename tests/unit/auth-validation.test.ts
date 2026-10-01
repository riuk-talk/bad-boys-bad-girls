import { describe, expect, it } from "vitest";
import { caseNumberFromId } from "@/lib/case-number";
import { fieldErrors, signupSchema } from "@/lib/validation/auth";

describe("signup validation", () => {
  it("accepts a valid email and a 12+ character password", () => {
    expect(
      signupSchema.safeParse({ email: " rebel@example.org ", password: "a".repeat(12) }).success,
    ).toBe(true);
  });

  it("returns i18n error keys per field", () => {
    const result = signupSchema.safeParse({ email: "nope", password: "short" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error)).toEqual({
        email: "emailInvalid",
        password: "passwordTooShort",
      });
    }
  });

  it("flags empty fields as required", () => {
    const result = signupSchema.safeParse({ email: "", password: "" });
    if (!result.success)
      expect(fieldErrors(result.error)).toEqual({ email: "required", password: "required" });
  });
});

describe("case number", () => {
  it("is deterministic and formatted BB-0000", () => {
    const id = "6f1c2a3e-1111-4222-8333-444455556666";
    expect(caseNumberFromId(id)).toMatch(/^BB-\d{4}$/);
    expect(caseNumberFromId(id)).toBe(caseNumberFromId(id));
  });
});
