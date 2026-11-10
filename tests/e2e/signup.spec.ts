import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { captcha } from "./helpers/captcha";
import { settled } from "./helpers/settle";

// Sign-up as a real person does it, LOCAL STACK ONLY (scripts/ci/local-env.mjs): the Visitor door
// of the landing, the form, the confirmation e-mail (read in Mailpit, the local mailbox of
// `supabase start`), the link, then steps 1 and 2 of the onboarding. In CI the captcha is on, with
// Cloudflare's test keys (the widget gives a dummy token the test secret accepts); locally there
// is no site key and the form works without it.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const mailpit = process.env.MAILPIT_URL ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  secret !== "" &&
  mailpit !== "";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function axeViolations(page: Page) {
  await settled(page);
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}

type MailpitSearch = { messages: { ID: string }[] };
type MailpitMessage = { Text: string };

async function confirmationLink(to: string): Promise<string> {
  let id = "";
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
        );
        const found = (await response.json()) as MailpitSearch;
        id = found.messages[0]?.ID ?? "";
        return id;
      },
      { message: `confirmation e-mail for ${to}`, timeout: 20_000 },
    )
    .not.toBe("");
  const message = (await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()) as MailpitMessage;
  const link = /https?:\/\/\S+\/auth\/v1\/verify\?\S+/.exec(message.Text)?.[0];
  if (!link) throw new Error("no confirmation link in the e-mail");
  return link;
}

test.describe("sign-up: landing door, e-mail confirmation, first steps (local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  test.describe.configure({ timeout: 90_000 });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const email = `e2e-signup-${randomBytes(4).toString("hex")}@example.com`;
  const typo: string[] = [];

  test.afterAll(async () => {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const user of data?.users ?? []) {
      if (user.email === email || typo.includes(user.email ?? "")) {
        await admin.auth.admin.deleteUser(user.id);
      }
    }
  });

  test("a Visitor signs up, confirms the e-mail and reaches the role step", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("link", { name: /Je viens visiter/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Prendre mon Permis de visite" })).toBeVisible();

    await page.getByLabel("E-mail").fill(email);
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(`Pw-${randomBytes(12).toString("base64url")}`);
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page.getByRole("heading", { name: "Vérifie ta boîte mail" })).toBeVisible();

    // The link of the e-mail, opened in the same browser (PKCE: the code verifier is here).
    await page.goto(await confirmationLink(email));
    await page.waitForURL(/onboarding\/1/, { waitUntil: "commit" });

    await page.getByLabel("Date de naissance").fill("1990-04-21");
    await page.getByLabel("J'atteste avoir 18 ans ou plus.").check();
    await page.locator("#terms").check();
    await page.locator("#privacy").check();
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.waitForURL(/onboarding\/2/, { waitUntil: "commit" });

    await page.getByLabel("Pseudo").fill(`Test ${randomBytes(3).toString("hex")}`);
    await page.getByLabel("Homme", { exact: true }).check();
    await page.getByRole("combobox").fill("toulon");
    await page.getByRole("option", { name: /^Toulon\s*83000$/ }).click();
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.waitForURL(/onboarding\/3/, { waitUntil: "commit" });

    // The door chosen on the landing preselects the role (SPEC v7 §2 bis).
    await expect(page.getByRole("radio", { name: /Je viens visiter/ })).toBeChecked();

    // Coming back to an unfinished dossier (10d): what is missing, a link to each step that can
    // be reached, and the way to resume.
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Ton dossier", level: 1 })).toBeVisible();
    const missing = page.getByRole("region", { name: "Il te manque :" });
    await expect(missing.getByRole("link", { name: /Ton rôle : Bad ou Visiteur/ })).toHaveAttribute(
      "href",
      /\/onboarding\/3$/,
    );
    await expect(missing).toContainText("Les 10 questions de l'Interrogatoire");
    await expect(missing).not.toContainText("Ta date de naissance");
    expect(await axeViolations(page)).toEqual([]);
    await missing.getByRole("link", { name: "Reprendre à l'étape 3" }).click();
    await page.waitForURL(/onboarding\/3$/, { waitUntil: "commit" });
  });

  // A mistyped domain (10d, a real case: « …@gmail.comj »): a suggestion, never a refusal; the
  // panel shows the address and « Corriger » brings it back in the form.
  test("a mistyped address: the suggestion, the address shown, « Corriger »", async ({ page }) => {
    const local = `e2e-typo-${randomBytes(4).toString("hex")}`;
    typo.push(`${local}@gmail.com`);
    await page.goto("/inscription");
    const field = page.getByLabel("E-mail");
    await field.fill(`${local}@gmail.comj`);
    await page.getByLabel("Mot de passe", { exact: true }).focus();
    const hint = page.getByRole("status").filter({ hasText: "Tu voulais dire" });
    await expect(hint).toHaveText(`Tu voulais dire ${local}@gmail.com ?`);
    expect(await axeViolations(page)).toEqual([]);
    await hint.getByRole("button", { name: `${local}@gmail.com` }).click();
    await expect(field).toHaveValue(`${local}@gmail.com`);
    await expect(hint).toHaveCount(0);

    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(`Pw-${randomBytes(12).toString("base64url")}`);
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    const panel = page.getByRole("status").filter({ hasText: "Vérifie ta boîte mail" });
    await expect(panel).toContainText(`Le lien part à ${local}@gmail.com.`);
    await panel.getByRole("button", { name: "Corriger" }).click();
    await expect(page.getByLabel("E-mail")).toHaveValue(`${local}@gmail.com`);
    await expect(page.getByLabel("E-mail")).toBeFocused();
  });

  // An address already registered gets the same answer as a new one (no account enumeration),
  // and the panel shows the way in for whoever already has an account.
  test("an address already registered: the same answer, and the way in", async ({ page }) => {
    const known = `e2e-known-${randomBytes(4).toString("hex")}@example.com`;
    const created = await admin.auth.admin.createUser({
      email: known,
      password: `Pw-${randomBytes(12).toString("base64url")}`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    try {
      await page.goto("/inscription");
      await page.getByLabel("E-mail").fill(known);
      await page
        .getByLabel("Mot de passe", { exact: true })
        .fill(`Pw-${randomBytes(12).toString("base64url")}`);
      await page.getByRole("button", { name: "Créer mon compte" }).click();
      const panel = page.getByRole("status").filter({ hasText: "Vérifie ta boîte mail" });
      await expect(panel.getByRole("heading", { name: "Vérifie ta boîte mail" })).toBeVisible();
      await expect(panel).toContainText(
        "Si tu as déjà un compte avec cette adresse, connecte-toi ou réinitialise ton mot de passe.",
      );
      await expect(panel.getByRole("link", { name: "connecte-toi" })).toHaveAttribute(
        "href",
        /\/connexion$/,
      );
      await panel.getByRole("link", { name: "réinitialise ton mot de passe" }).click();
      await expect(page).toHaveURL(/\/mot-de-passe-oublie$/);
    } finally {
      await admin.auth.admin.deleteUser(created.data.user.id);
    }
  });

  test("a wrong password: the message, and « Mot de passe oublié ? » right under it", async ({
    page,
  }) => {
    const known = `e2e-wrong-${randomBytes(4).toString("hex")}@example.com`;
    const created = await admin.auth.admin.createUser({
      email: known,
      password: `Pw-${randomBytes(12).toString("base64url")}`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    try {
      await page.goto("/connexion");
      await page.getByLabel("E-mail").fill(known);
      await page.getByLabel("Mot de passe", { exact: true }).fill("not-the-password-1");
      await page.getByRole("button", { name: "Se connecter" }).click();
      const alert = page
        .getByRole("alert")
        .filter({ hasText: "E-mail ou mot de passe incorrect." });
      await expect(alert).toBeVisible();
      const forgot = page.getByRole("link", { name: "Mot de passe oublié ?" });
      await expect(forgot).toHaveCount(1);
      await expect(forgot).toBeVisible();
      // Right under the message: the next thing in the form.
      const follows = await alert.evaluate((node) => {
        const next = node.nextElementSibling;
        return Boolean(next?.querySelector('a[href$="/mot-de-passe-oublie"]'));
      });
      expect(follows).toBe(true);
      await forgot.click();
      await expect(page).toHaveURL(/\/mot-de-passe-oublie$/);
    } finally {
      await admin.auth.admin.deleteUser(created.data.user.id);
    }
  });

  // Phase 8a: Supabase Auth itself refuses what the form refuses (a direct call with the
  // publishable key cannot go below 12 characters).
  test("Auth refuses a password shorter than 12 characters", async () => {
    const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
      auth: { persistSession: false },
    });
    const { error } = await anon.auth.signUp({
      email: `e2e-weak-${randomBytes(4).toString("hex")}@example.com`,
      password: "Pw-12345678",
      options: captcha,
    });
    expect(error?.code).toBe("weak_password");
  });
});
