import { describe, expect, it } from "vitest";
import {
  BODY_MAX,
  FILES_MAX,
  checkFiles,
  greffeErrorKey,
  greffeUpdateSchema,
  mergeGreffe,
  newestOf,
  readMark,
  type GreffeMessage,
} from "@/lib/greffe-mail";

const message = (id: number, side: "team" | "member"): GreffeMessage => ({
  id,
  side,
  label: side === "team" ? "Le Greffe · Sam" : null,
  body: `m${id}`,
  kind: "text",
  is_moderation: false,
  pose: null,
  created_at: "2026-11-22T10:00:00Z",
  attachments: [],
  attachments_removed: 0,
  proposal: null,
});

describe("Messagerie du Greffe (10g)", () => {
  it("keeps the limits of the database", () => {
    expect(BODY_MAX).toBe(2000);
    expect(FILES_MAX).toBe(5);
  });

  it("merges new messages without doubles, in order", () => {
    const merged = mergeGreffe(
      [message(1, "team"), message(3, "member")],
      [message(2, "member"), message(3, "member")],
    );
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("shows « Lu » under the last own message the other side read", () => {
    const list = [message(1, "team"), message(2, "member"), message(3, "team"), message(4, "team")];
    expect(readMark(list, "team", 3)).toBe(3);
    expect(readMark(list, "team", 0)).toBe(null);
    expect(readMark(list, "member", 5)).toBe(2);
    expect(newestOf(list, "team")).toBe(4);
    expect(newestOf(list, "member")).toBe(2);
  });

  it("checks the chosen images: at most 5, 10 MB each, known formats (HEIC by name too)", () => {
    const file = (size: number, type: string, name = "a.jpg") => ({ size, type, name });
    expect(checkFiles([file(1000, "image/jpeg")])).toBe(null);
    expect(checkFiles([file(1000, "", "IMG_1.HEIC")])).toBe(null);
    expect(checkFiles(Array.from({ length: 6 }, () => file(1, "image/png")))).toBe("tooMany");
    expect(checkFiles([file(11 * 1024 * 1024, "image/jpeg")])).toBe("tooBig");
    expect(checkFiles([file(10, "image/gif", "a.gif")])).toBe("badType");
    expect(checkFiles([file(10, "application/pdf", "a.pdf")])).toBe("badType");
  });

  it("translates the database's error codes, anything else is generic", () => {
    expect(greffeErrorKey("thread_closed")).toBe("thread_closed");
    expect(greffeErrorKey("member_unreachable")).toBe("member_unreachable");
    expect(greffeErrorKey("something else")).toBe("generic");
    expect(greffeErrorKey(undefined)).toBe("generic");
  });

  it("reads what the database answers, and never a made-up shape", () => {
    expect(
      greffeUpdateSchema.safeParse({
        archived_at: null,
        member_read_id: 0,
        team_read_id: 2,
        messages: [message(2, "team")],
      }).success,
    ).toBe(true);
    expect(greffeUpdateSchema.safeParse({ messages: [{ id: "x" }] }).success).toBe(false);
  });
});
