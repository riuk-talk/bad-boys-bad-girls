import { describe, expect, it } from "vitest";
import {
  decisionsSchema,
  isModerationError,
  moderationErrorKey,
  motiveSchema,
  sanctionSchema,
} from "@/lib/moderation";

describe("motiveSchema (mirror of private.motive)", () => {
  it("needs 10 to 1,000 characters once trimmed", () => {
    expect(motiveSchema.safeParse("   court   ").success).toBe(false);
    expect(motiveSchema.safeParse("x".repeat(1001)).success).toBe(false);
    expect(motiveSchema.parse("  Propos insultants.  ")).toBe("Propos insultants.");
  });
});

describe("moderationErrorKey", () => {
  it("keeps the keys raised by Postgres, anything else is generic", () => {
    expect(moderationErrorKey("admin_protected")).toBe("admin_protected");
    expect(moderationErrorKey("reason_required")).toBe("reason_required");
    expect(moderationErrorKey("duplicate key value")).toBe("generic");
    expect(moderationErrorKey(undefined)).toBe("generic");
  });

  it("only known keys come back from the address bar", () => {
    expect(isModerationError("invalid_days")).toBe(true);
    expect(isModerationError("<script>")).toBe(false);
    expect(isModerationError(undefined)).toBe(false);
  });
});

describe("shapes returned by Postgres", () => {
  it("reads a sanction in force, or none", () => {
    expect(sanctionSchema.parse(null)).toBeNull();
    expect(
      sanctionSchema.parse({ state: "suspended", until: "2026-10-22T10:00:00Z", reason: "Motif" }),
    ).toMatchObject({ state: "suspended" });
    expect(sanctionSchema.parse({ state: "review" })).toEqual({ state: "review" });
  });

  it("reads my decisions without anything about the other person", () => {
    const parsed = decisionsSchema.parse({
      reports: [
        {
          id: 1,
          created_at: "2026-10-19T10:00:00Z",
          category: "harassment",
          target_type: "profile",
          status: "upheld",
          decided_at: "2026-10-19T11:00:00Z",
          reason: "Merci, retenu.",
          target_user_id: "should be dropped",
        },
      ],
      decisions: [],
    });
    expect(parsed.reports[0]).not.toHaveProperty("target_user_id");
  });
});
