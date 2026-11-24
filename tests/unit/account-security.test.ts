import { describe, expect, it } from "vitest";
import {
  emailChangeSchema,
  emailUpdateOutcome,
  passwordChangeSchema,
  passwordUpdateMessage,
  sameAddress,
} from "@/lib/auth/account-security";

// Ma fiche › Mon compte (10j): the rules of the forms and what an error of Supabase Auth says.
describe("password change", () => {
  it("asks the current password and the sign-up policy for the new one", () => {
    expect(passwordChangeSchema.safeParse({ current: "", password: "x".repeat(12) }).success).toBe(
      false,
    );
    expect(
      passwordChangeSchema.safeParse({ current: "old", password: "x".repeat(11) }).success,
    ).toBe(false);
    expect(
      passwordChangeSchema.safeParse({ current: "old", password: "x".repeat(12) }).success,
    ).toBe(true);
  });

  it("names each refusal of Supabase Auth", () => {
    expect(passwordUpdateMessage({ code: "same_password" })).toBe("samePassword");
    expect(passwordUpdateMessage({ code: "weak_password" })).toBe("weakPassword");
    expect(passwordUpdateMessage({ code: "insufficient_aal" })).toBe("secondFactorRequired");
    expect(passwordUpdateMessage({ code: "reauthentication_needed" })).toBe("signInAgain");
    expect(passwordUpdateMessage({ status: 429 })).toBe("rateLimited");
    expect(passwordUpdateMessage({ code: "unexpected_failure" })).toBe("generic");
  });
});

describe("e-mail change", () => {
  it("asks a valid address and the current password", () => {
    expect(emailChangeSchema.safeParse({ email: "pas-une-adresse", current: "pw" }).success).toBe(
      false,
    );
    expect(emailChangeSchema.safeParse({ email: "a@example.com", current: "" }).success).toBe(
      false,
    );
    expect(emailChangeSchema.safeParse({ email: " a@example.com ", current: "pw" }).success).toBe(
      true,
    );
  });

  it("answers the same for an address already used (no enumeration)", () => {
    expect(emailUpdateOutcome({ code: "email_exists", status: 422 })).toBe("sent");
    expect(emailUpdateOutcome({ code: "user_already_exists" })).toBe("sent");
  });

  it("names the guards of the database and the rate limit", () => {
    expect(emailUpdateOutcome({ message: "Database error: email_banned" })).toBe("emailBanned");
    expect(emailUpdateOutcome({ message: "super_admin_protected" })).toBe("superAdmin");
    expect(emailUpdateOutcome({ code: "over_email_send_rate_limit" })).toBe("rateLimited");
    expect(emailUpdateOutcome({ code: "unexpected_failure" })).toBe("generic");
  });

  it("sees the same address whatever its case and spaces", () => {
    expect(sameAddress(" Rose@Example.com", "rose@example.com ")).toBe(true);
    expect(sameAddress("rose@example.com", "rose@example.fr")).toBe(false);
  });
});
