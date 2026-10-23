import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { settled } from "./helpers/settle";
import { cutoutReady } from "./helpers/onboarding";

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
  // Measured on the final rendering, never in the middle of a fade (dialogs fade in).
  await settled(page);
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
  // A photo page reached by a client-side navigation may load itself again once: wait for it.
  if ((await page.locator("[data-cutout-engine]").count()) > 0) await cutoutReady(page);
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

    // The tab bar of a Visitor: Promenade, Découverte, Demandes, Visites, Mon Permis.
    await page.goto("/promenade");
    const tabs = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(tabs.getByRole("link")).toHaveText([
      "Promenade",
      "Découverte",
      "Demandes",
      "Visites",
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

    // The Fiche (FichePancarte.dc.html): the 3 poses on the wall, the placard in front of them.
    await page.waitForURL(/\/fiche\//);
    const fiche = page.getByTestId("fiche");
    await expect(fiche.getByRole("heading", { level: 1, name: bad.pseudo })).toBeVisible();
    await expect(fiche.getByText("Dossier judiciaire")).toBeVisible();
    await expect(fiche.getByText(/^N° \d{6}$/)).toBeVisible();
    await expect(fiche.getByText("Complicité 100 %")).toBeVisible();
    await expect(fiche.getByText(/^Bad girl · 30 ans · Port-Test/)).toBeVisible();
    await expect(fiche.getByText(/^Signes : .*Triumph de 1974/)).toBeVisible();
    await expect(fiche.getByText("Cherche : bad boys, 25 à 45 ans")).toBeVisible();
    await expect(fiche.getByText(/^Note : Motarde, allergique/)).toBeVisible();
    await expect(fiche.getByText("Ouvert aux visites")).toBeVisible();
    // Never the birth date, a real name or a height (SPEC §5).
    await expect(fiche.getByText(/1996|02\/03|cm\b|CONFIDENTIEL/)).toHaveCount(0);
    for (const pose of ["profil gauche", "de face", "profil droit"])
      await expect(fiche.getByRole("img", { name: `${bad.pseudo}, ${pose}` })).toBeVisible();
    // Read as text, in order: the photos, the front, then the back (inert until turned over).
    const order = await fiche.evaluate((root) => {
      const nodes = [
        root.querySelector("img"),
        root.querySelector("h1"),
        root.querySelector("#pancarte-charges"),
      ];
      return nodes.every(
        (node, index) =>
          node !== null &&
          (index === 0 ||
            (nodes[index - 1]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !==
              0),
      );
    });
    expect(order).toBe(true);
    await expect(fiche.getByRole("radio")).toHaveCount(0);
    // No request without a bet: the bar sends to the placard first.
    const bar = page.getByTestId("fiche-action");
    await expect(bar.getByRole("button", { name: /^Demander une visite/ })).toHaveCount(0);
    await expect(
      bar.getByRole("button", { name: "Retourne la pancarte et parie pour demander" }),
    ).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-fiche");

    // « Chefs d'accusation » turns only the placard over: the 3 charges as a radio group.
    await fiche.getByRole("button", { name: "Chefs d'accusation" }).click();
    const charges = fiche.getByRole("group", { name: "Chefs d'accusation · 1 vrai · 2 faux" });
    await expect(charges.getByRole("radio")).toHaveCount(3);
    for (const charge of CHARGES)
      await expect(charges.getByRole("radio", { name: new RegExp(charge) })).not.toBeChecked();
    await expect(fiche.getByRole("region", { name: "Chefs d'accusation" })).toBeFocused();
    await expect(fiche.getByRole("heading", { level: 1 })).toHaveCount(0);
    await expect(fiche.getByRole("img", { name: `${bad.pseudo}, de face` })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    // With less motion asked, the placard turns at once.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const duration = await page
      .locator(".placard")
      .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    expect(duration).toBeLessThan(0.01);
    await page.emulateMedia({ reducedMotion: null });

    // The bet, kept on the page only: nothing is recorded before the request is sent (rule 14).
    await charges.getByText(CHARGES[0]!).click();
    await charges.getByText(CHARGES[1]!).click();
    const ask = bar.getByRole("button", { name: "Demander une visite · pari n° 2" });
    await expect(ask).toBeVisible();
    await shot(page, "visitor-fiche-verso");
    const { count: before } = await admin
      .from("visit_requests")
      .select("id", { count: "exact", head: true })
      .eq("visitor_id", visitor.id);
    expect(before).toBe(0);

    // Back to the front, focus on its button; the bet stays.
    await fiche.getByRole("button", { name: "Retourner" }).click();
    await expect(fiche.getByRole("button", { name: "Chefs d'accusation" })).toBeFocused();
    await expect(ask).toBeVisible();

    // A photo full screen, the 3 poses one after the other; Escape gives the focus back.
    const face = fiche.getByRole("button", { name: `${bad.pseudo}, de face Agrandir` });
    await face.click();
    const viewer = page.getByRole("dialog", { name: `Photo signalétique de ${bad.pseudo}` });
    await expect(viewer.getByText("Pose 2 sur 3")).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Fermer" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(viewer.getByText("Pose 3 sur 3")).toBeVisible();
    // A swipe is a scroll of the strip.
    await viewer.locator(".snap-x").evaluate((el) => el.scrollTo({ left: 0 }));
    await expect(viewer.getByText("Pose 1 sur 3")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-fiche-photo");
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(face).toBeFocused();

    // A large screen: the same composition, enlarged and centred.
    await page.setViewportSize({ width: 1280, height: 900 });
    const box = await fiche.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(640);
    expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - 640)).toBeLessThan(20);
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-fiche-large");
    await page.setViewportSize({ width: 390, height: 900 });

    // A full Parloir: the button says so, disabled.
    await admin.from("profiles").update({ requests_closed_manual: true }).eq("id", bad.id);
    await page.reload();
    await expect(bar.getByRole("button", { name: "Parloir complet" })).toBeDisabled();
    await admin.from("profiles").update({ requests_closed_manual: false }).eq("id", bad.id);
    await page.reload();

    // La Demande de parloir opens with the bet made on the placard, still changeable.
    await fiche.getByRole("button", { name: "Chefs d'accusation" }).click();
    await charges.getByText(CHARGES[1]!).click();
    await ask.click();
    const dialog = page.getByRole("dialog", { name: "Demande de parloir" });
    await expect(dialog.getByText("Lequel est vrai, selon toi ?")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: new RegExp(CHARGES[1]!) })).toBeChecked();
    await expect(dialog.getByText(/Ton pari reste/)).toBeVisible();
    const hooks = dialog.getByRole("button", { name: /^« / });
    await expect(hooks).toHaveCount(3);
    for (const text of await hooks.allTextContents())
      for (const charge of CHARGES) expect(text).not.toContain(charge);
    await dialog.getByText(CHARGES[0]!).click();
    await expect(dialog.getByRole("radio", { name: new RegExp(CHARGES[0]!) })).toBeChecked();
    await dialog.getByText(CHARGES[1]!).click();
    await hooks.nth(1).click();
    await expect(dialog.getByRole("textbox")).not.toHaveValue("");
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-demande");
    await dialog.getByRole("button", { name: "Déposer ma demande" }).click();
    await expect(page.getByRole("heading", { name: "Demande déposée au Parloir" })).toBeVisible();
    // Nothing about the bet comes back: no « Bien vu », no « Raté », no true line.
    await expect(page.getByRole("dialog").getByText(/Bien vu|Raté/)).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Once sent, the button follows the request.
    await expect(bar.getByRole("button", { name: "Demande envoyée" })).toBeDisabled();

    await page.goto("/demandes");
    await expect(page.getByText("EN ATTENTE")).toBeVisible();
    for (const charge of CHARGES) await expect(page.getByText(charge)).toHaveCount(0);
    // Notifications are offered now (first request sent), not before; nothing is registered
    // until the member says yes, and « Plus tard » is remembered (30 days).
    const prompt = page.getByTestId("push-prompt");
    if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      await expect(prompt).toBeVisible();
      // An iPhone outside the home screen cannot subscribe: the prompt leads to the guide instead.
      if (/iPhone/.test(await page.evaluate(() => navigator.userAgent))) {
        await expect(prompt.getByRole("link", { name: "Voir comment faire" })).toHaveAttribute(
          "href",
          "/installer",
        );
      } else {
        await expect(
          prompt.getByRole("button", { name: "Activer les notifications" }),
        ).toBeVisible();
      }
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
    await expect(tabs.getByRole("link")).toHaveText(["Courrier", "Visites", "Ma Fiche"]);
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

    // Accepting means sending the Heures de visite (Phase 5b): « Demain soir » and a slot of one's own.
    await page.getByRole("link", { name: "Accepter la visite" }).click();
    await expect(page.getByRole("heading", { name: "Tes Heures de visite" })).toBeVisible();
    await expect(page.getByRole("img", { name: /visite acceptée/i })).toBeVisible();
    await page.getByRole("button", { name: /^Demain soir/ }).click();
    await page.getByRole("button", { name: "+ Choisir un autre jour et une autre heure" }).click();
    await page.getByRole("button", { name: "Ajouter ce créneau" }).click();
    await expect(page.getByText("Tes créneaux (2 sur 3)")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "bad-heures-de-visite");
    await page.getByRole("button", { name: "Envoyer mes Heures de visite" }).click();
    await expect(page.getByText(/Heures de visite envoyées/)).toBeVisible();
    await shot(page, "bad-visite-acceptee");
    const { data: request } = await admin
      .from("visit_requests")
      .select("status, guess_correct")
      .eq("bad_id", bad.id)
      .single();
    expect(request?.status).toBe("accepted");
    expect(request?.guess_correct).toBe(true);

    // « Voir ma Fiche »: the Fiche as a Visitor sees it, back readable, no bet, no request.
    await page.goto("/ma-fiche");
    await page.getByRole("link", { name: "Voir ma Fiche" }).click();
    await page.waitForURL(/\/fiche\//);
    const own = page.getByTestId("fiche");
    await expect(own.getByRole("heading", { level: 1, name: bad.pseudo })).toBeVisible();
    await own.getByRole("button", { name: "Chefs d'accusation" }).click();
    await expect(
      own.getByRole("heading", { name: "Chefs d'accusation · 1 vrai · 2 faux" }),
    ).toBeVisible();
    await expect(own.getByRole("listitem")).toHaveText(CHARGES.map((c, i) => `${i + 1}. ${c}`));
    await expect(own.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Demander une visite/ })).toHaveCount(0);
    await expect(
      page.getByText("C'est ta Fiche, telle que les Visiteurs la voient."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Signaler" })).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "bad-voir-ma-fiche");

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
