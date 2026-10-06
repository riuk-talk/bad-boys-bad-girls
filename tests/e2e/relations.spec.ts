import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";

// Phase 4 end to end against a Supabase project (the local stack in CI, or the DEV project): a Visitor finds a Bad, files a Demande de
// parloir with the Souffleur, the Bad reads it in the Courrier and accepts; reports, blocks,
// pause. Throwaway accounts (admin API), a throwaway open zone around a fictitious place in the
// Atlantic (nobody real can be in it), everything deleted afterwards. Opt-in: E2E_ALLOW_WRITE=true.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const enabled = process.env.E2E_ALLOW_WRITE === "true" && url !== "" && secret !== "";
const WCAG = ["wcag2a", "wcag2aa", "wcag21aa"];
const SHOTS = process.env.E2E_SCREENSHOTS ?? "";

const CHARGES = [
  "A dormi une nuit entière dans un photomaton.",
  "A donné un nom à sa moto : Josiane.",
  "A chanté sur scène devant trois cents personnes.",
];

async function axeViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  // Every image of the page must be loaded (lazy ones included) before the capture.
  await page.evaluate(async () => {
    for (const image of Array.from(document.images)) {
      image.loading = "eager";
      if (!image.complete)
        await new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
    }
  });
  // The proxy of the test environment sometimes drops one of several parallel downloads
  // (net::ERR_TOO_MANY_RETRIES): a broken image is fetched once more before it counts as broken.
  const broken = await page.evaluate(async () => {
    const failed = Array.from(document.images).filter((image) => image.naturalWidth === 0);
    for (const image of failed) {
      const source = image.currentSrc || image.src;
      await new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
        image.srcset = "";
        image.src = `${source}${source.includes("?") ? "&" : "?"}retry=1`;
      });
    }
    return failed.filter((image) => image.naturalWidth === 0).map((image) => image.src);
  });
  expect(broken, `broken images on ${name}`).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function login(browser: Browser, email: string, password: string) {
  // Device projects (Pixel 7, iPhone 14) keep their own screen; the others are checked at 390 px.
  const viewport = test.info().project.use.isMobile ? undefined : { width: 390, height: 900 };
  const context = await browser.newContext({
    ...(viewport ? { viewport } : {}),
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await page.goto("/connexion");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  // The login goes to /onboarding, which redirects a finished member once more: wait for the
  // final page, or the next navigation is interrupted (WebKit).
  await page.waitForURL((target) => !/^\/(connexion|onboarding)$/.test(target.pathname));
  return page;
}

test.describe("Phase 4: Promenade, Fiche, Demande de parloir, Courrier (real Supabase, writes data)", () => {
  test.skip(!enabled, "E2E_ALLOW_WRITE / SUPABASE_SECRET_KEY not set");
  // Each test walks through many screens (axe audits, captures) while other suites write in parallel.
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  // One run is enough (the flow is the same at every width); the screens are checked at 390 px.
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 1000, "runs once, on the mobile project");

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const accounts: string[] = [];
  const publicFiles: string[] = [];
  let placeId = 0;
  let zoneId = 0;
  const bad = { email: "", password: "", id: "", pseudo: `Lune${randomBytes(2).toString("hex")}` };
  const visitor = {
    email: "",
    password: "",
    id: "",
    pseudo: `Nox${randomBytes(2).toString("hex")}`,
  };

  async function account() {
    const email = `e2e-${randomBytes(4).toString("hex")}@example.com`;
    const password = `Pw-${randomBytes(12).toString("base64url")}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    accounts.push(data.user.id);
    return { email, password, id: data.user.id };
  }

  async function approvedPhoto(owner: string, position: number, color: string) {
    const name = randomUUID();
    const large = await sharp({
      create: { width: 960, height: 1200, channels: 3, background: color },
    })
      .webp()
      .toBuffer();
    const small = await sharp(large).resize(320, 400).webp().toBuffer();
    for (const [path, body] of [
      [`${name}.webp`, large],
      [`${name}-s.webp`, small],
    ] as const) {
      const { error } = await admin.storage
        .from("photos")
        .upload(path, body, { contentType: "image/webp" });
      if (error) throw error;
      publicFiles.push(path);
    }
    const { data, error } = await admin
      .from("photos")
      .insert({ owner_id: owner, position })
      .select("id")
      .single();
    if (error) throw error;
    await admin
      .from("photos")
      .update({
        status: "approved",
        public_path_large: `${name}.webp`,
        public_path_small: `${name}-s.webp`,
      })
      .eq("id", data.id);
  }

  async function member(
    target: { email: string; password: string; id: string; pseudo: string },
    role: "bad" | "visitor",
    gender: "woman" | "man",
  ) {
    Object.assign(target, await account());
    const { error } = await admin.from("profiles").insert({
      id: target.id,
      pseudo: target.pseudo,
      birthdate: role === "bad" ? "1996-03-02" : "1992-06-11",
      gender,
      seeking_genders: [gender === "woman" ? "man" : "woman"],
      seek_age_min: 25,
      seek_age_max: 45,
      place_id: placeId,
      role,
      visit_motive:
        role === "visitor"
          ? "Graphiste le jour, motard la nuit. Je préfère une route de montagne à un dîner guindé."
          : null,
      bio:
        role === "bad"
          ? "Motarde, allergique aux plans trop sages. Préfère une vraie conversation à cent messages tièdes."
          : null,
    });
    if (error) throw error;
    await admin
      .from("profiles")
      .update({
        onboarding_completed_at: new Date().toISOString(),
        onboarding_step: 8,
        last_seen_at: new Date().toISOString(),
        created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
      })
      .eq("id", target.id);
    const { data: questions } = await admin
      .from("questions")
      .select("id")
      .eq("phase", "core")
      .eq("is_active", true);
    await admin.from("answers").insert(
      (questions ?? []).map((q) => ({
        user_id: target.id,
        question_id: q.id,
        option_id: q.id * 10 + 1,
      })),
    );
    await admin.from("profile_tribes").insert({
      profile_id: target.id,
      tribe_id: 1,
      detail: role === "bad" ? "Triumph de 1974" : null,
    });
    for (const position of role === "bad" ? [0, 1, 2] : [0]) {
      await approvedPhoto(target.id, position, gender === "woman" ? "#7a2a3a" : "#2a4a7a");
    }
  }

  test.beforeAll(async () => {
    const { data: place, error: placeError } = await admin
      .from("places")
      .insert({
        official_code: `E2E${randomBytes(3).toString("hex")}`,
        name: "Port-Test",
        lat: 46.21,
        lng: -8.13,
      })
      .select("id")
      .single();
    if (placeError) throw placeError;
    placeId = place.id;
    const { data: zone, error: zoneError } = await admin
      .from("launch_zones")
      .insert({
        slug: `e2e-${randomBytes(3).toString("hex")}`,
        name: "Port-Test",
        center_place_id: placeId,
        radius_km: 5,
        status: "open",
      })
      .select("id")
      .single();
    if (zoneError) throw zoneError;
    zoneId = zone.id;
    await member(bad, "bad", "woman");
    await member(visitor, "visitor", "man");
    const { error } = await admin.from("casier_charges").insert({
      profile_id: bad.id,
      charge_1: CHARGES[0],
      charge_2: CHARGES[1],
      charge_3: CHARGES[2],
      true_index: 2,
    });
    if (error) throw error;
  });

  test.afterAll(async () => {
    if (publicFiles.length) await admin.storage.from("photos").remove(publicFiles);
    for (const userId of accounts) await admin.auth.admin.deleteUser(userId);
    if (zoneId) await admin.from("launch_zones").delete().eq("id", zoneId);
    if (placeId) await admin.from("places").delete().eq("id", placeId);
  });

  test("Visitor: Promenade, Découverte, the Fiche as a judicial file, the Demande de parloir", async ({
    browser,
  }) => {
    const page = await login(browser, visitor.email, visitor.password);

    // The tab bar of a Visitor: Promenade, Découverte, Demandes, Mon Permis (no Visites tab yet).
    await page.goto("/promenade");
    const tabs = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(tabs.getByRole("link")).toHaveText([
      "Promenade",
      "Découverte",
      "Demandes",
      "Mon Permis",
    ]);
    await expect(page.getByText(/Prochaine Promenade dans/)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // Tonight's Promenade (built in advance by the job; here one pick visible now).
    const now = Date.now();
    await admin.from("promenade_picks").insert({
      visitor_id: visitor.id,
      bad_id: bad.id,
      zone_id: zoneId,
      promenade_date: new Date().toISOString().slice(0, 10),
      rank: 1,
      score: 100,
      visible_from: new Date(now - 3600000).toISOString(),
      visible_until: new Date(now + 3600000).toISOString(),
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: /1 Bad sort dans la cour/ })).toBeVisible();
    await expect(page.getByText("Complicité 100 %")).toBeVisible();
    await shot(page, "visitor-promenade");

    await page.goto("/decouverte");
    await expect(page.getByRole("heading", { name: "La Découverte" })).toBeVisible();
    await page.getByText("Filtres").click();
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-decouverte");
    await page
      .getByRole("link", { name: new RegExp(bad.pseudo) })
      .first()
      .click();

    // The Fiche: the judicial file, three charges without the true one, the N° d'écrou.
    await page.waitForURL(/\/fiche\//);
    await expect(
      page.getByRole("heading", { name: "Dossier judiciaire · Profil rencontre" }),
    ).toBeVisible();
    await expect(page.getByText("1 VRAI · 2 FAUX")).toBeVisible();
    for (const charge of CHARGES)
      await expect(page.locator("article").getByText(charge, { exact: true })).toBeVisible();
    await expect(page.getByText(/N° D'ÉCROU \d{6} \|/)).toBeVisible();
    await expect(page.getByText("COMPLICITÉ : 100 %")).toBeVisible();
    await expect(page.getByText("[●●● CONFIDENTIEL]")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-fiche");
    // Landscape on a large screen (maquette FicheLarge.dc.html).
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-fiche-large");
    await page.setViewportSize({ width: 390, height: 900 });

    // La Demande de parloir: the bet, the Souffleur, the secret.
    await page.getByRole("button", { name: "Demander une visite" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Lequel est vrai, selon toi ?")).toBeVisible();
    await expect(dialog.getByText(/Ton pari reste/)).toBeVisible();
    const hooks = dialog.getByRole("button", { name: /^« / });
    await expect(hooks).toHaveCount(3);
    for (const text of await hooks.allTextContents())
      for (const charge of CHARGES) expect(text).not.toContain(charge);
    await expect(dialog.getByRole("button", { name: "Déposer ma demande" })).toBeDisabled();
    await dialog.getByText(CHARGES[1]!).click();
    await hooks.nth(1).click();
    await expect(dialog.getByRole("textbox")).not.toHaveValue("");
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-demande");
    await dialog.getByRole("button", { name: "Déposer ma demande" }).click();
    await expect(dialog.getByRole("heading", { name: "Demande déposée au Parloir" })).toBeVisible();
    // Nothing about the bet comes back: no « Bien vu », no « Raté », no true line.
    await expect(dialog.getByText(/Bien vu|Raté/)).toHaveCount(0);

    await page.goto("/demandes");
    await expect(page.getByText("EN ATTENTE")).toBeVisible();
    for (const charge of CHARGES) await expect(page.getByText(charge)).toHaveCount(0);
    // Notifications are offered now (first request sent), not before; nothing is registered
    // until the member says yes, and « Plus tard » is remembered (30 days).
    const prompt = page.getByTestId("push-prompt");
    if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      await expect(prompt).toBeVisible();
      await expect(prompt.getByRole("button", { name: "Activer les notifications" })).toBeVisible();
    }
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-demandes-push");
    expect(
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    ).toBe(0);
    if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      await prompt.getByRole("button", { name: "Plus tard" }).click();
      await expect(prompt).toHaveCount(0);
      await expect
        .poll(async () => {
          await page.reload();
          await expect(page.getByText("EN ATTENTE")).toBeVisible();
          return page.getByTestId("push-prompt").count();
        })
        .toBe(0);
    }
    await page.context().close();
  });

  test("Bad: the Courrier, reading the request, accepting the visit", async ({ browser }) => {
    const page = await login(browser, bad.email, bad.password);
    await page.goto("/courrier");
    const tabs = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(tabs.getByRole("link")).toHaveText(["Courrier", "Ma Fiche"]);
    await expect(page.getByRole("heading", { name: "1 demande de visite" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "bad-courrier");

    await page.getByRole("link", { name: new RegExp(visitor.pseudo) }).click();
    await expect(page.getByText("PERMIS DE VISITE")).toBeVisible();
    await expect(page.getByText(/a parié sur un de tes chefs d'accusation/)).toBeVisible();
    // Rule 14: the Bad never sees which charge was chosen, nor the result.
    const body = (await page.locator("main").textContent()) ?? "";
    for (const charge of CHARGES) expect(body).not.toContain(charge);
    expect(body).not.toMatch(/Bien vu|Raté|chef n°/i);
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "bad-lire-demande");

    await page.getByRole("button", { name: "Accepter la visite" }).click();
    await expect(page.getByRole("img", { name: /visite acceptée/i })).toBeVisible();
    await shot(page, "bad-visite-acceptee");
    const { data: request } = await admin
      .from("visit_requests")
      .select("status, guess_correct")
      .eq("bad_id", bad.id)
      .single();
    expect(request?.status).toBe("accepted");
    expect(request?.guess_correct).toBe(true);

    // Pause and cap from Ma Fiche / the Courrier settings.
    await page.goto("/ma-fiche");
    await page.getByRole("button", { name: "Mettre en pause" }).click();
    await expect(page.getByRole("button", { name: "Reprendre" })).toBeVisible();
    await page.goto("/courrier");
    await expect(page.getByText("Fiche en pause")).toBeVisible();
    await page.goto("/ma-fiche");
    await page.getByRole("button", { name: "Reprendre" }).click();
    await expect(page.getByRole("button", { name: "Mettre en pause" })).toBeVisible();
    await page.context().close();
  });

  test("Visitor: the accepted visit, then Signaler and Bloquer from the Fiche", async ({
    browser,
  }) => {
    const page = await login(browser, visitor.email, visitor.password);
    await page.goto("/demandes");
    await expect(page.getByRole("img", { name: /visite acceptée/i })).toBeVisible();
    await shot(page, "visitor-mes-demandes");

    await page.goto(`/fiche/${bad.id}`);
    await page.getByRole("button", { name: "Signaler" }).click();
    const report = page.getByRole("dialog", { name: /Signaler/ });
    await report.getByLabel("Faux profil").check();
    expect(await axeViolations(page)).toEqual([]);
    await report.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(report.getByText(/Merci. Le Greffe va regarder/)).toBeVisible();
    await report.getByRole("button", { name: "Fermer" }).first().click();

    await page.getByRole("button", { name: "Bloquer" }).click();
    const block = page.getByRole("dialog", { name: /Bloquer/ });
    await block.getByRole("button", { name: "Bloquer" }).click();
    await page.waitForURL(/\/promenade/);
    const response = await page.goto(`/fiche/${bad.id}`);
    expect(response?.status()).toBe(404);

    // Ma Fiche lists the blocked member; unblocking keeps the history.
    await page.goto("/ma-fiche");
    await expect(page.getByText(bad.pseudo)).toBeVisible();
    await page.getByRole("button", { name: "Débloquer" }).click();
    await expect(page.getByText("Tu n'as bloqué personne.")).toBeVisible();
    const { data: blocks } = await admin
      .from("blocks")
      .select("unblocked_at")
      .eq("blocker_id", visitor.id);
    expect(blocks?.[0]?.unblocked_at).not.toBeNull();
    await page.context().close();
  });
});
