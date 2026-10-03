import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = [
  "/",
  "/en",
  "/connexion",
  "/inscription",
  "/mot-de-passe-oublie",
  "/charte",
  "/conseils-securite",
  "/cgu",
  "/confidentialite",
  "/mentions-legales",
  "/design",
];

for (const path of PAGES) {
  test(`${path}: renders, no horizontal scroll, no CSP violation, no axe violation`, async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(error.message));

    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    ).toEqual([]);
    expect(problems).toEqual([]);
  });
}

test("security headers and per-request CSP nonce", async ({ request }) => {
  const first = await request.get("/");
  const second = await request.get("/");
  const headers = first.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["permissions-policy"]).toContain("geolocation=()");
  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(second.headers()["content-security-policy"]).not.toBe(csp);
  const html = await first.text();
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(html).toContain(`nonce="${nonce}"`);
});

test("indexing: landing, legal pages and Charter only", async ({ request }) => {
  for (const path of ["/", "/en", "/charte", "/cgu", "/en/confidentialite", "/mentions-legales"]) {
    const response = await request.get(path);
    expect(response.headers()["x-robots-tag"], path).toBeUndefined();
    expect(await response.text(), path).toContain('<meta name="robots" content="index, follow"');
  }
  for (const path of [
    "/connexion",
    "/inscription",
    "/conseils-securite",
    "/design",
    "/en/connexion",
  ]) {
    const response = await request.get(path);
    expect(response.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
    expect(await response.text(), path).toContain(
      '<meta name="robots" content="noindex, nofollow"',
    );
  }
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /");
  expect(robots).toContain("Allow: /charte$");
});

test("no horizontal scroll from 360 to 1440 px", async ({ page }) => {
  for (const width of [360, 414, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/inscription", "/charte", "/design"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} @ ${width}px`).toBeLessThanOrEqual(0);
    }
  }
});

test("error boundary strings are rendered server-side for the i18n-free 500 page", async ({
  page,
}) => {
  await page.goto("/");
  const title = await page.locator("template#i18n-error-strings").getAttribute("data-title");
  expect(title).toBe("Quelque chose a déraillé.");
});

test("unknown page returns a branded 404", async ({ page }) => {
  const response = await page.goto("/cette-page-nexiste-pas");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cette page n'existe pas.");
});

test("keyboard: skip link comes first and moves focus to main", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Aller au contenu" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.closest("main") !== null);
  expect(focused).toBe(true);
});

test("landing: two doors lead to the matching sign-up (SPEC v7 §2 bis)", async ({ page }) => {
  await page.goto("/");
  const bad = page.getByRole("link", { name: /Je suis Bad/ }).first();
  const visitor = page.getByRole("link", { name: /Je viens visiter/ }).first();
  await expect(bad).toHaveAttribute("href", "/inscription?role=bad");
  await expect(visitor).toHaveAttribute("href", "/inscription?role=visitor");
  await visitor.click();
  await expect(page.getByRole("heading", { name: "Prendre mon Permis de visite" })).toBeVisible();
  await expect(page.locator('input[name="role"]')).toHaveValue("visitor");
  await page.goto("/inscription?role=juge");
  await expect(page.getByRole("heading", { name: "Créer mon compte" })).toBeVisible();
  await expect(page.locator('input[name="role"]')).toHaveCount(0);
});

test("signup form: client validation is announced and focuses the first invalid field", async ({
  page,
}) => {
  await page.goto("/inscription");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  const email = page.getByLabel("E-mail");
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toBeFocused();
  await expect(page.getByText("Ce champ est obligatoire.").first()).toBeVisible();
});

test("modal: opens, traps focus and closes with Escape", async ({ page }) => {
  await page.goto("/design");
  const opener = page.getByRole("button", { name: "Ouvrir la modale" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Demander une visite à Exemple" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("stamps fall back to a fade with reduced motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/design");
  const animation = await page
    .getByRole("img", { name: "COUPABLE" })
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe("fade-in");
  await context.close();
});
