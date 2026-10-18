import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { totp } from "./helpers/admin";

// Password recovery as a person does it, LOCAL STACK ONLY (scripts/ci/local-env.mjs): « Mot de
// passe oublié », the e-mail read in Mailpit, the link, the new password, then a sign-in with it.
// A member goes straight to the new password. The super admin (second factor enrolled) is at
// aal1 after the link and Supabase Auth refuses a new password below aal2 (insufficient_aal): the
// screen asks for the TOTP code first. The /admin guard stays as it is (aal2 at each session).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const mailpit = process.env.MAILPIT_URL ?? "";
const dbUrl = process.env.SUPABASE_DB_URL ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  /@(127\.0\.0\.1|localhost):/.test(dbUrl) &&
  [publishable, secret, mailpit].every((value) => value !== "");

type MailpitSearch = { messages: { ID: string }[] };
type MailpitMessage = { Text: string };

async function recoveryLink(to: string): Promise<string> {
  let id = "";
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
        );
        id = ((await response.json()) as MailpitSearch).messages[0]?.ID ?? "";
        return id;
      },
      { message: `recovery e-mail for ${to}`, timeout: 20_000 },
    )
    .not.toBe("");
  const message = (await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()) as MailpitMessage;
  const link = /https?:\/\/\S+\/auth\/v1\/verify\?\S+/.exec(message.Text)?.[0];
  if (!link) throw new Error("no recovery link in the e-mail");
  return link;
}

function asOwner(sql: string) {
  execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], { stdio: "pipe" });
}

function newAccount() {
  return {
    email: `e2e-recovery-${randomBytes(4).toString("hex")}@example.com`,
    password: `Pw-${randomBytes(12).toString("base64url")}`,
    next: `Pw-${randomBytes(12).toString("base64url")}`,
    id: "",
  };
}

/** « Mot de passe oublié », then the link of the e-mail: lands on /nouveau-mot-de-passe. */
async function openRecovery(browser: Browser, email: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/mot-de-passe-oublie");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Envoyer le lien" }).click();
  await expect(page.getByText(/Si un compte existe avec cette adresse/)).toBeVisible();
  await page.goto(await recoveryLink(email));
  await page.waitForURL(/\/nouveau-mot-de-passe$/);
  await expect(page.getByRole("heading", { name: "Nouveau mot de passe" })).toBeVisible();
  return page;
}

async function signsInWith(email: string, password: string): Promise<boolean> {
  const client = createClient(url, publishable, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  return !error;
}

test.describe("password recovery: a member, the super admin (local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  test.describe.configure({ timeout: 90_000 });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const ids: string[] = [];

  test.afterAll(async () => {
    for (const id of ids) {
      asOwner(`delete from public.super_admins where user_id = '${id}'`);
      await admin.auth.admin.deleteUser(id);
    }
  });

  test("a member chooses a new password from the e-mail link", async ({ browser }) => {
    const account = newAccount();
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
    });
    if (error) throw error;
    ids.push(data.user.id);

    const page = await openRecovery(browser, account.email);
    await expect(page.getByLabel("Code à 6 chiffres")).toHaveCount(0);
    await page.getByLabel("Mot de passe", { exact: true }).fill(account.next);
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await page.waitForURL((target) => !target.pathname.endsWith("/nouveau-mot-de-passe"));
    await page.context().close();

    expect(await signsInWith(account.email, account.next)).toBe(true);
    expect(await signsInWith(account.email, account.password)).toBe(false);
  });

  test("the super admin passes the second factor, then chooses a new password", async ({
    browser,
  }) => {
    const account = newAccount();
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
    });
    if (error) throw error;
    ids.push(data.user.id);
    asOwner(`insert into public.super_admins (user_id, note) values ('${data.user.id}', 'e2e')`);
    // The second factor, enrolled as on /acces-admin.
    const member = createClient(url, publishable, { auth: { persistSession: false } });
    await member.auth.signInWithPassword({ email: account.email, password: account.password });
    const enrolled = await member.auth.mfa.enroll({ factorType: "totp" });
    if (enrolled.error) throw enrolled.error;
    const factorSecret = enrolled.data.totp.secret;
    const verified = await member.auth.mfa.challengeAndVerify({
      factorId: enrolled.data.id,
      code: totp(factorSecret),
    });
    if (verified.error) throw verified.error;

    const page = await openRecovery(browser, account.email);
    // aal1 after the link: the code first, no password field yet.
    await expect(page.getByRole("heading", { name: "Ton second facteur" })).toBeVisible();
    await expect(page.getByLabel("Mot de passe", { exact: true })).toHaveCount(0);
    await page.getByLabel("Code à 6 chiffres").fill("000000");
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page.getByText(/Code incorrect ou expiré/)).toBeVisible();
    await page.getByLabel("Code à 6 chiffres").fill(totp(factorSecret));
    await page.getByRole("button", { name: "Vérifier" }).click();
    await page.getByLabel("Mot de passe", { exact: true }).fill(account.next);
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await page.waitForURL((target) => !target.pathname.endsWith("/nouveau-mot-de-passe"));
    await page.context().close();

    expect(await signsInWith(account.email, account.next)).toBe(true);
    expect(await signsInWith(account.email, account.password)).toBe(false);

    // The /admin guard is unchanged: a new session with the new password still needs the code.
    const fresh = await (await browser.newContext()).newPage();
    await fresh.goto("/connexion");
    await fresh.getByLabel("E-mail").fill(account.email);
    await fresh.getByLabel("Mot de passe", { exact: true }).fill(account.next);
    await fresh.getByRole("button", { name: "Se connecter" }).click();
    await fresh.waitForURL(/\/acces-admin$/);
    await expect(fresh.getByRole("heading", { name: "Double authentification" })).toBeVisible();
    await fresh.context().close();
  });
});
