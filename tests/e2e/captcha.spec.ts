import { expect, test } from "@playwright/test";
import { captchaOn } from "./helpers/captcha";

// The anti-robot check (Turnstile, verified by Supabase Auth) seen from the forms, IN CI ONLY:
// the stack runs with the captcha on and Cloudflare's test keys (scripts/ci/local-env.mjs). The
// script of Turnstile is held or blocked here to see the button wait for the token, and the
// message when the check cannot load (ad blocker, browser shield).
const SCRIPT = /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/;

test.describe("anti-robot check of the forms (captcha on, Cloudflare test keys)", () => {
  test.skip(!captchaOn, "captcha off (the CI turns it on with Cloudflare's test keys)");

  test("sign-in: the button stays disabled until Turnstile gives its token", async ({ page }) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(SCRIPT, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto("/connexion");
    const submit = page.getByRole("button", { name: "Se connecter" });
    await expect(submit).toBeDisabled();
    await expect(page.getByText("Vérification anti-robot en cours…")).toBeVisible();
    release();
    await expect(submit).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByText("Vérification anti-robot en cours…")).toHaveCount(0);
    await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(
      "XXXX.DUMMY.TOKEN.XXXX",
    );
    // The magic link and « mot de passe oublié » wait the same way.
    await page.getByText("Par lien magique").click();
    await expect(page.getByRole("button", { name: "Recevoir mon lien" })).toBeEnabled();
  });

  test("a blocked check says so, and « Réessayer » starts it again", async ({ page }) => {
    await page.route(SCRIPT, (route) => route.abort());
    await page.goto("/inscription");
    const submit = page.getByRole("button", { name: "Créer mon compte" });
    await expect(page.getByText(/La vérification anti-robot n'a pas pu se charger/)).toBeVisible();
    await expect(submit).toBeDisabled();
    await page.unroute(SCRIPT);
    await page.getByRole("button", { name: "Réessayer" }).click();
    await expect(submit).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByText(/n'a pas pu se charger/)).toHaveCount(0);
  });

  test("a script that never answers: the message after 10 s, then « Réessayer »", async ({
    page,
  }) => {
    // Held for good: neither loaded nor failed, as behind some browser shields.
    await page.route(SCRIPT, () => undefined);
    await page.goto("/mot-de-passe-oublie");
    const submit = page.getByRole("button", { name: "Envoyer le lien" });
    await expect(submit).toBeDisabled();
    await expect(page.getByText(/n'a pas pu se charger/)).toBeVisible({ timeout: 15_000 });
    await page.unroute(SCRIPT);
    await page.getByRole("button", { name: "Réessayer" }).click();
    await expect(submit).toBeEnabled({ timeout: 20_000 });
  });
});
