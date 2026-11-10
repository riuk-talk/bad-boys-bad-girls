import { describe, expect, it } from "vitest";
import { memberFiltersQuery, parseMemberDetail, parseMemberFilters } from "@/lib/admin/members";

const detail = {
  id: "2b0c0000-0000-4000-8000-000000000000",
  has_profile: true,
  account_created_at: "2026-11-01T10:00:00Z",
  email_confirmed_at: "2026-11-01T10:05:00Z",
  last_sign_in_at: null,
  last_seen_at: null,
  pseudo: "Lune",
  role: "bad",
  state: "onboarding",
  gender: "woman",
  age: 30,
  city: "Toulon",
  zone: "Toulon",
  seeking_genders: ["man"],
  seek_age_min: 25,
  seek_age_max: 40,
  bio: null,
  visit_motive: null,
  tribes: [{ label: { fr: "Biker", en: "Biker" }, detail: null }],
  casier: ["Un", "Deux", "Trois"],
  answers: 10,
  photos: [
    {
      position: 0,
      status: "approved",
      rejection_reason: null,
      cutout: true,
      waived: false,
      created_at: "2026-11-01T10:10:00Z",
      reviewed_at: "2026-11-01T11:00:00Z",
      pending_path: null,
      public_small: "x-s.webp",
    },
  ],
  consents: [{ type: "terms", granted: true, version: "v1", created_at: "2026-11-01T10:06:00Z" }],
  missing: ["casier"],
  blocked: false,
  hidden_reasons: ["dossier_incomplete", "poses_not_validated"],
};

describe("admin, Membres (10d)", () => {
  it("reads the filters of the list, anything unknown is no filter", () => {
    expect(
      parseMemberFilters({ role: "bad", etat: "onboarding", dossier: "inacheve", page: "3" }),
    ).toEqual({ role: "bad", state: "onboarding", complete: false, blocked: false, page: 3 });
    expect(parseMemberFilters({ role: "admin", etat: "x", dossier: "?", page: "-2" })).toEqual({
      role: null,
      state: null,
      complete: null,
      blocked: false,
      page: 1,
    });
    expect(parseMemberFilters({ bloques: "1" }).blocked).toBe(true);
  });

  it("keeps the filters from one page to the next", () => {
    const filters = parseMemberFilters({ role: "visitor", dossier: "termine", bloques: "1" });
    expect(memberFiltersQuery(filters, 2)).toBe("?role=visitor&dossier=termine&bloques=1&page=2");
    expect(memberFiltersQuery(parseMemberFilters({}))).toBe("");
  });

  it("reads the record, never a true charge", () => {
    const parsed = parseMemberDetail(detail);
    expect(parsed?.casier).toEqual(["Un", "Deux", "Trois"]);
    expect(parsed?.missing).toEqual(["casier"]);
    expect(parseMemberDetail({ ...detail, true_index: 2 })).toBe(null);
    expect(parseMemberDetail({ ...detail, missing: ["nope"] })).toBe(null);
    expect(parseMemberDetail({ ...detail, hidden_reasons: ["secret"] })).toBe(null);
    expect(parseMemberDetail(null)).toBe(null);
  });
});
