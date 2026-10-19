import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { openGreffe } from "./helpers/admin";

// The super admin (Phase 5a-ter), LOCAL STACK ONLY: the real Auth service (session
// supabase_auth_admin, out of reach of pgTAP) cannot delete or ban the account; the secret key
// cannot remove the role or give it a profile; at sign-in the account goes to /admin, through the
// second factor, never to the onboarding. Role granted and removed as the database owner (psql).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const dbUrl = process.env.SUPABASE_DB_URL ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  /@(127\.0\.0\.1|localhost):/.test(dbUrl) &&
  secret !== "";

/** SQL as the database owner (what the owner does by hand in the SQL editor). */
function asOwner(sql: string) {
  execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], { stdio: "pipe" });
}

test.describe("super admin (local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const account = {
    email: `e2e-super-${randomBytes(4).toString("hex")}@example.com`,
    password: `Pw-${randomBytes(12).toString("base64url")}`,
    id: "",
  };

  test.beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
    });
    if (error) throw error;
    account.id = data.user.id;
    asOwner(`insert into public.super_admins (user_id, note) values ('${account.id}', 'e2e')`);
  });

  test.afterAll(() => {
    if (!account.id) return;
    asOwner(`delete from public.super_admins where user_id = '${account.id}'`);
    asOwner(`delete from auth.users where id = '${account.id}'`);
  });

  test("the Auth service cannot delete, soft-delete or ban the account", async () => {
    expect((await admin.auth.admin.deleteUser(account.id)).error).not.toBeNull();
    expect((await admin.auth.admin.deleteUser(account.id, true)).error).not.toBeNull();
    const ban = await admin.auth.admin.updateUserById(account.id, { ban_duration: "876000h" });
    expect(ban.error).not.toBeNull();
    const { data } = await admin.auth.admin.getUserById(account.id);
    expect(data.user?.id).toBe(account.id);
    expect(data.user?.banned_until ?? null).toBeNull();
  });

  test("the secret key cannot remove the role or give the account a profile", async () => {
    const removed = await admin.from("super_admins").delete().eq("user_id", account.id);
    expect(removed.error).not.toBeNull();
    const profile = await admin.from("profiles").insert({
      id: account.id,
      pseudo: `Sup${randomBytes(2).toString("hex")}`,
      birthdate: "1980-01-01",
      gender: "man",
      seeking_genders: ["woman"],
    });
    expect(profile.error).not.toBeNull();
  });

  test("at sign-in: /admin through the second factor, never the onboarding", async ({ page }) => {
    await openGreffe(page, account);
    await page.goto("/onboarding/1");
    await page.waitForURL(/\/admin\/greffe/);
    const { data } = await admin.from("profiles").select("id").eq("id", account.id);
    expect(data).toEqual([]);
  });
});
