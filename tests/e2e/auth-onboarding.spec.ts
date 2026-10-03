import { expect, test } from "@playwright/test";

// Runs against a real Supabase project with a confirmed test account (never in production):
// E2E_EMAIL / E2E_PASSWORD. Skipped when they are not set.
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe("auth and onboarding (real Supabase)", () => {
  test.skip(!email || !password, "E2E_EMAIL / E2E_PASSWORD not set");
  test.use({ viewport: { width: 390, height: 900 } });

  test("anonymous members are sent to the login page", async ({ page }) => {
    await page.goto("/ma-fiche");
    await expect(page).toHaveURL(/\/connexion$/);
  });

  test("a wrong password keeps the e-mail and shows a generic message", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByLabel("E-mail").fill(email!);
    await page.getByLabel("Mot de passe", { exact: true }).fill("wrong-password-123");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText("E-mail ou mot de passe incorrect.")).toBeVisible();
    await expect(page.getByLabel("E-mail")).toHaveValue(email!);
  });

  test("login leads to the onboarding; a minor birthdate is refused", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByLabel("E-mail").fill(email!);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(/\/onboarding\/\d|\/ma-fiche|\/ville-bientot/, { waitUntil: "commit" });
    if (!/onboarding\/1/.test(page.url())) test.skip(true, "test account already past step 1");
    const minor = new Date();
    minor.setFullYear(minor.getFullYear() - 17);
    await page.getByLabel("Date de naissance").fill(minor.toISOString().slice(0, 10));
    await page.getByLabel("J'atteste avoir 18 ans ou plus.").check();
    await page.locator("#terms").check();
    await page.locator("#privacy").check();
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByText("Tu dois avoir 18 ans ou plus pour t'inscrire.")).toBeVisible();
    await expect(page.getByLabel("Date de naissance")).toBeFocused();
    await expect(page.locator("#terms")).toBeChecked();
  });
});
