import { describe, expect, it } from "vitest";
import { ADMIN_NAV, homeFor, navFor } from "@/lib/admin/nav";
import { ADMIN_PERMISSIONS, parsePermissions, ROLE_PERMISSIONS } from "@/lib/admin/permissions";

const OBSERVER = [
  "dashboard.view",
  "members.view",
  "members.detail",
  "vue_visiteur.view",
  "history.view",
] as const;

describe("administration roles (10f)", () => {
  it("knows the 17 permissions; team.manage is never a role's box", () => {
    expect(ADMIN_PERMISSIONS).toHaveLength(17);
    expect(ROLE_PERMISSIONS).toHaveLength(16);
    expect(ROLE_PERMISSIONS).not.toContain("team.manage");
  });

  it("keeps only the permissions it knows, never a made-up one", () => {
    expect(parsePermissions(["members.view", "god.mode", 3, null])).toEqual(["members.view"]);
    expect(parsePermissions(null)).toEqual([]);
  });

  it("every entry of the menu asks for a permission", () => {
    for (const item of ADMIN_NAV.flatMap((group) => group.items)) {
      expect(ADMIN_PERMISSIONS).toContain(item.permission);
    }
    expect(
      ADMIN_NAV.flatMap((g) => g.items).find((i) => i.href === "/admin/equipe")?.permission,
    ).toBe("team.manage");
  });

  it("shows an Observateur only what it reads", () => {
    const hrefs = navFor(OBSERVER).flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toEqual(["/admin", "/admin/membres", "/admin/historique", "/admin/vue"]);
    expect(navFor(OBSERVER).map((group) => group.key)).toEqual([null, "accounts", "tools"]);
  });

  it("lands a role on the dashboard, or else on its first page", () => {
    expect(homeFor(OBSERVER)).toBe("/admin");
    expect(homeFor(["greffe.decide"])).toBe("/admin/greffe");
    expect(homeFor([])).toBe(null);
    expect(navFor([...ADMIN_PERMISSIONS]).flatMap((g) => g.items)).toHaveLength(
      ADMIN_NAV.flatMap((g) => g.items).length,
    );
  });
});
