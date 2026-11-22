import { beforeEach, describe, expect, it, vi } from "vitest";

// The /admin layout (Phase 5a-ter): admins only, and only with a second factor (aal2).
const member = { aal: "aal1", role: "none" };
const notFound = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
const redirect = vi.fn(({ href }: { href: string }) => {
  throw new Error(`REDIRECT ${href}`);
});

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "fr" }));
vi.mock("@/i18n/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/user", () => ({
  requireMember: async () => ({
    aal: member.aal,
    userId: "u",
    metadata: {},
    supabase: {
      rpc: async (name: string) =>
        name === "admin_counts"
          ? { data: [{ photos_pending: 2, reports_open: 1, flags_open: 0 }], error: null }
          : { data: member.role, error: null },
    },
  }),
}));

vi.mock("@/components/admin/admin-shell", () => ({ AdminShell: () => null }));

// The page itself, inside the admin shell (10c), with the counters of the menu.
async function render() {
  const { default: AdminLayout } = await import("@/app/[locale]/(app)/admin/layout");
  const element = await AdminLayout({ children: "the Greffe" });
  const props = element.props as { children: unknown; initialCounts: unknown };
  expect(props.initialCounts).toEqual({
    photos_pending: 2,
    reports_open: 1,
    flags_open: 0,
    messages_unread: null,
  });
  return props.children;
}

describe("/admin layout", () => {
  beforeEach(() => {
    notFound.mockClear();
    redirect.mockClear();
  });

  it("is a 404 for a member who is not an admin, even with a second factor", async () => {
    Object.assign(member, { role: "none", aal: "aal2" });
    await expect(render()).rejects.toThrow("NOT_FOUND");
  });

  it("sends an admin without a second factor to /acces-admin", async () => {
    Object.assign(member, { role: "admin", aal: "aal1" });
    await expect(render()).rejects.toThrow("REDIRECT /acces-admin");
  });

  it("sends the super admin without a second factor to /acces-admin too", async () => {
    Object.assign(member, { role: "super_admin", aal: "aal1" });
    await expect(render()).rejects.toThrow("REDIRECT /acces-admin");
  });

  it("lets an admin with a second factor in", async () => {
    Object.assign(member, { role: "admin", aal: "aal2" });
    await expect(render()).resolves.toBe("the Greffe");
    Object.assign(member, { role: "super_admin", aal: "aal2" });
    await expect(render()).resolves.toBe("the Greffe");
  });
});
