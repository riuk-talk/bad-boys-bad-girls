import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { captcha } from "./helpers/captcha";
import { settled } from "./helpers/settle";

// Ma fiche › Mon compte (10j, question 10-22), LOCAL STACK ONLY: change one's password (the other
// sessions are closed, « Ton mot de passe a changé » arrives) and one's e-mail (the same message at
// both addresses, the address changes only once both links are opened, the old one is told).
// Refused: a wrong current password, a banned address, the same address; the database refuses a
// banned address and the super admin's change even when the Auth API is called directly.
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

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

type MailpitSearch = { messages: { ID: string; Subject: string }[] };
type MailpitMessage = { HTML: string };

async function axeViolations(page: Page) {
  // Target sizes measured with the tab bar in the flow, as the journey's sweep does (9 ter):
  // content scrolled under a sticky bar is not a small target.
  await page.addStyleTag({ content: "[data-tab-bar] { position: static !important; }" });
  await settled(page);
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}

function asOwner(sql: string): string {
  return execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

/** The messages received at `to` with this subject (Mailpit), polled until there are `count`. */
async function mails(to: string, subject: string, count = 1): Promise<string[]> {
  let ids: string[] = [];
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`,
        );
        ids = ((await response.json()) as MailpitSearch).messages.map((m) => m.ID);
        return ids.length;
      },
      { message: `« ${subject} » for ${to}`, timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(count);
  return Promise.all(
    ids.map(
      async (id) =>
        ((await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()) as MailpitMessage).HTML,
    ),
  );
}

/** The first message received at `to` with this subject. */
async function mail(to: string, subject: string): Promise<string> {
  return (await mails(to, subject))[0] ?? "";
}

/** The link of an e-mail, as the browser would follow it. */
function linkOf(html: string): string {
  const href = /href="([^"]+)"/.exec(html)?.[1];
  if (!href) throw new Error("no link in the e-mail");
  return href.replaceAll("&amp;", "&");
}

function apiClient(): SupabaseClient {
  return createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signsInWith(email: string, password: string): Promise<boolean> {
  const { error } = await apiClient().auth.signInWithPassword({
    email,
    password,
    options: captcha,
  });
  return !error;
}

test.describe("Mon compte: password and e-mail (10j, local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const ids: string[] = [];
  let placeId = 0;

  async function member() {
    const who = {
      email: `e2e-account-${randomBytes(4).toString("hex")}@example.com`,
      password: `Pw-${randomBytes(12).toString("base64url")}`,
      id: "",
    };
    const { data, error } = await admin.auth.admin.createUser({
      email: who.email,
      password: who.password,
      email_confirm: true,
    });
    if (error) throw error;
    who.id = data.user.id;
    ids.push(who.id);
    const { error: inserted } = await admin.from("profiles").insert({
      id: who.id,
      pseudo: `Compte${randomBytes(2).toString("hex")}`,
      birthdate: "1992-03-04",
      gender: "man",
      seeking_genders: ["woman"],
      place_id: placeId,
      role: "visitor",
      visit_motive: "Je viens pour une vraie conversation, sans détour.",
    });
    if (inserted) throw inserted;
    const { error: done } = await admin
      .from("profiles")
      .update({ onboarding_completed_at: new Date().toISOString(), onboarding_step: 8 })
      .eq("id", who.id);
    if (done) throw done;
    return who;
  }

  async function signIn(browser: Browser, email: string, password: string) {
    const page = await (await browser.newContext()).newPage();
    await page.goto("/connexion");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL((target) => !/^\/(connexion|onboarding)$/.test(target.pathname));
    await expect(page.locator("main h1").first()).toBeVisible();
    return page;
  }

  test.beforeAll(async () => {
    const { data: place, error } = await admin
      .from("places")
      .insert({
        official_code: `E2E${randomBytes(3).toString("hex")}`,
        name: "Port-Compte",
        lat: 46.7,
        lng: -8.4,
      })
      .select("id")
      .single();
    if (error) throw error;
    placeId = place.id;
  });

  test.afterAll(async () => {
    for (const id of ids) {
      asOwner(`delete from public.super_admins where user_id = '${id}'`);
      await admin.auth.admin.deleteUser(id);
    }
    if (placeId) asOwner(`delete from public.places where id = ${placeId}`);
  });

  test("the password: current one asked, others signed out, the e-mail of Auth", async ({
    browser,
  }) => {
    const rex = await member();
    // A second device, signed in before the change.
    const other = apiClient();
    const { error: otherIn } = await other.auth.signInWithPassword({
      email: rex.email,
      password: rex.password,
      options: captcha,
    });
    expect(otherIn).toBeNull();

    const page = await signIn(browser, rex.email, rex.password);
    await page.goto("/ma-fiche");
    await page.getByRole("link", { name: "Changer de mot de passe" }).click();
    await expect(
      page.getByRole("heading", { name: "Changer de mot de passe", level: 1 }),
    ).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    const next = `Pw-${randomBytes(12).toString("base64url")}`;
    const submit = page.getByRole("button", { name: "Changer de mot de passe" });
    await page.getByLabel("Mot de passe actuel").fill("pas-le-bon-mot-de-passe");
    await page.getByLabel("Nouveau mot de passe").fill(next);
    await submit.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Mot de passe actuel incorrect." }),
    ).toBeVisible();
    await page.getByLabel("Mot de passe actuel").fill(rex.password);
    await page.getByLabel("Nouveau mot de passe").fill("court");
    await submit.click();
    await expect(
      page.getByText("Le mot de passe doit contenir au moins 12 caractères."),
    ).toBeVisible();
    await page.getByLabel("Nouveau mot de passe").fill(next);
    await submit.click();
    await expect(
      page.getByRole("status").filter({ hasText: "Mot de passe changé." }),
    ).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    expect(await signsInWith(rex.email, next)).toBe(true);
    expect(await signsInWith(rex.email, rex.password)).toBe(false);
    // The other device cannot renew its session any more; this browser stays signed in.
    const { error: renewed } = await other.auth.refreshSession();
    expect(renewed).not.toBeNull();
    await page.goto("/ma-fiche");
    await expect(page.getByRole("link", { name: "Changer d'e-mail" })).toBeVisible();
    const notice = await mail(rex.email, "Ton mot de passe a changé");
    expect(notice).toContain("vient d'être changé");
    await page.context().close();
  });

  test("the e-mail: both addresses confirm, the old one is told; refusals", async ({ browser }) => {
    const lou = await member();
    const banned = `e2e-banni-${randomBytes(4).toString("hex")}@example.com`;
    asOwner(
      `insert into public.banned_email_hashes (hash, expires_at) values (public.ban_email_hash('${banned}'), now() + interval '1 day')`,
    );
    const page = await signIn(browser, lou.email, lou.password);
    await page.goto("/ma-fiche");
    await page.getByRole("link", { name: "Changer d'e-mail" }).click();
    await expect(page.getByRole("heading", { name: "Changer d'e-mail", level: 1 })).toBeVisible();
    await expect(page.getByText(lou.email)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    const address = page.getByLabel("Nouvelle adresse e-mail");
    const current = page.getByLabel("Mot de passe actuel");
    const submit = page.getByRole("button", { name: "Changer d'e-mail" });
    const alert = page.getByRole("alert");
    // A mistyped domain is pointed out (10d), never refused.
    await address.fill("lou@gmail.comj");
    await current.focus();
    await expect(page.getByText(/Tu voulais dire/)).toBeVisible();
    await address.fill(lou.email.toUpperCase());
    await current.fill(lou.password);
    await submit.click();
    await expect(alert.filter({ hasText: "C'est déjà l'adresse de ton compte." })).toBeVisible();
    await address.fill(banned);
    await current.fill(lou.password);
    await submit.click();
    await expect(
      alert.filter({ hasText: "Cette adresse ne peut plus être utilisée sur le site." }),
    ).toBeVisible();
    const fresh = `e2e-nouvelle-${randomBytes(4).toString("hex")}@example.com`;
    await address.fill(fresh);
    await current.fill("pas-le-bon-mot-de-passe");
    await submit.click();
    await expect(alert.filter({ hasText: "Mot de passe actuel incorrect." })).toBeVisible();
    await current.fill(lou.password);
    await submit.click();
    await expect(page.getByRole("status").filter({ hasText: fresh })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // Nothing changes before the links: the same message at both addresses.
    expect(asOwner(`select email from auth.users where id = '${lou.id}'`)).toBe(lou.email);
    const toOld = await mail(lou.email, "Changement d'adresse e-mail de ton compte");
    const toNew = await mail(fresh, "Changement d'adresse e-mail de ton compte");
    expect(toOld).toContain("Si ce n'est pas toi");
    await page.goto("/ma-fiche/e-mail");
    await expect(page.getByText(/Changement en attente vers/)).toBeVisible();

    await page.goto(linkOf(toOld));
    await expect(page.getByText("Première confirmation reçue.")).toBeVisible();
    expect(asOwner(`select email from auth.users where id = '${lou.id}'`)).toBe(lou.email);
    await page.goto(linkOf(toNew));
    await expect(
      page.getByText("C'est fait : ton compte utilise désormais cette adresse."),
    ).toBeVisible();
    expect(asOwner(`select email from auth.users where id = '${lou.id}'`)).toBe(fresh);
    await expect(page.getByText(fresh).first()).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    const told = await mail(lou.email, "L'adresse de ton compte a changé");
    expect(told).toContain(fresh);
    expect(await signsInWith(fresh, lou.password)).toBe(true);

    // The Auth API called directly, without this page: the database still refuses the banned address.
    const direct = apiClient();
    await direct.auth.signInWithPassword({
      email: fresh,
      password: lou.password,
      options: captcha,
    });
    const { error: refused } = await direct.auth.updateUser({ email: banned });
    expect(refused).not.toBeNull();
    expect(
      asOwner(`select coalesce(email_change, '') from auth.users where id = '${lou.id}'`),
    ).toBe("");
    await page.context().close();
  });

  test("the super admin: no change of address, not even through the Auth API", async ({
    browser,
  }) => {
    const chief = {
      email: `e2e-chef-${randomBytes(4).toString("hex")}@example.com`,
      password: `Pw-${randomBytes(12).toString("base64url")}`,
    };
    const { data, error } = await admin.auth.admin.createUser({
      email: chief.email,
      password: chief.password,
      email_confirm: true,
    });
    if (error) throw error;
    ids.push(data.user.id);
    asOwner(`insert into public.super_admins (user_id, note) values ('${data.user.id}', 'e2e')`);

    // This page is not theirs: the member area sends them to /admin.
    const page = await (await browser.newContext()).newPage();
    await page.goto("/connexion");
    await page.getByLabel("E-mail").fill(chief.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(chief.password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    // At aal1, the super admin is sent to the second factor (/acces-admin).
    await page.waitForURL(/\/acces-admin/);
    await page.goto("/ma-fiche/e-mail");
    await page.waitForURL(/\/(admin|acces-admin)/);
    await expect(page.getByRole("button", { name: "Changer d'e-mail" })).toHaveCount(0);
    await page.context().close();

    const direct = apiClient();
    await direct.auth.signInWithPassword({ ...chief, options: captcha });
    const { error: refused } = await direct.auth.updateUser({
      email: `e2e-autre-${randomBytes(4).toString("hex")}@example.com`,
    });
    expect(refused).not.toBeNull();
    expect(
      asOwner(
        `select email || '|' || coalesce(email_change, '') from auth.users where id = '${data.user.id}'`,
      ),
    ).toBe(`${chief.email}|`);
  });
});
