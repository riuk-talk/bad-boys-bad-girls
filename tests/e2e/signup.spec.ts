import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

// Sign-up as a real person does it, LOCAL STACK ONLY (scripts/ci/local-env.mjs): the Visitor door
// of the landing, the form, the confirmation e-mail (read in Mailpit, the local mailbox of
// `supabase start`), the link, then steps 1 and 2 of the onboarding. Turnstile is not loaded
// (no site key locally): the captcha is checked by Supabase Auth in production, not by the app.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const mailpit = process.env.MAILPIT_URL ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  secret !== "" &&
  mailpit !== "";

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

  test.afterAll(async () => {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const user = data?.users.find((u) => u.email === email);
    if (user) await admin.auth.admin.deleteUser(user.id);
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
    });
    expect(error?.code).toBe("weak_password");
  });
});
