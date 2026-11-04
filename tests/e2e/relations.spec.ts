import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { settled } from "./helpers/settle";
import { openGreffe } from "./helpers/admin";
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
    // Validated as cut out (9k: a validated pose is cut out, or waived by the Greffe).
    const { error: approveError } = await admin
      .from("photos")
      .update({
        status: "approved",
        is_cutout: true,
        public_path_large: `${name}.webp`,
        public_path_small: `${name}-s.webp`,
      })
      .eq("id", data.id);
    if (approveError) throw approveError;
  }

  /** A pose sent as it is (the device could not cut it out): it waits for the Greffe. */
  async function poseForTheGreffe(owner: string, position: number, color: string) {
    const name = `${owner}/${randomUUID()}`;
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
        .from("photos-pending")
        .upload(path, body, { contentType: "image/webp" });
      if (error) throw error;
    }
    const { error } = await admin
      .from("photos")
      .insert({ owner_id: owner, position, pending_path: `${name}.webp`, needs_cutout: true });
    if (error) throw error;
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
    const color = gender === "woman" ? "#7a2a3a" : "#2a4a7a";
    for (const position of role === "bad" ? [0, 1] : [0]) {
      await approvedPhoto(target.id, position, color);
    }
    // The Bad's right profile waits for the Greffe, which validates it without cut-out (9k).
    if (role === "bad") await poseForTheGreffe(target.id, 2, "#5a3a2a");
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
    for (const userId of accounts) {
      const { data: rows } = await admin
        .from("photos")
        .select("public_path_large, public_path_small")
        .eq("owner_id", userId);
      for (const row of rows ?? [])
        for (const path of [row.public_path_large, row.public_path_small])
          if (path && !publicFiles.includes(path)) publicFiles.push(path);
      const { data: pending } = await admin.storage.from("photos-pending").list(userId);
      if (pending?.length)
        await admin.storage
          .from("photos-pending")
          .remove(pending.map((file) => `${userId}/${file.name}`));
    }
    if (publicFiles.length) await admin.storage.from("photos").remove(publicFiles);
    for (const userId of accounts) await admin.auth.admin.deleteUser(userId);
    if (zoneId) await admin.from("launch_zones").delete().eq("id", zoneId);
    if (placeId) await admin.from("places").delete().eq("id", placeId);
  });

  test("Greffe: a pose validated without cut-out, the motive kept internal (9k)", async ({
    browser,
  }) => {
    const greffier = { ...(await account()), totpSecret: "" };
    await admin.from("admin_users").insert({ user_id: greffier.id, note: "e2e waiver" });
    const greffe = await (await browser.newContext()).newPage();
    greffier.totpSecret = await openGreffe(greffe, greffier);
    await greffe.goto("/admin/greffe");
    const card = greffe
      .getByRole("listitem")
      .filter({ has: greffe.locator("p", { hasText: `${bad.pseudo} · Bad · Profil droit` }) });
    await expect(card.getByTestId("cutout-state")).toHaveText(
      "À détourer par le Greffe avant validation",
    );
    // Cutting out stays the default (first); the button to validate without cut-out is in
    // view right under it, with its required motive.
    await expect(card.getByRole("button", { name: "Détourer" })).toBeVisible();
    const waiver = card.getByRole("button", { name: "Valider sans détourage" });
    await expect(waiver).toBeVisible();
    await expect(card.getByLabel("Motif (interne)")).toHaveAttribute("required", "");
    expect(await axeViolations(greffe)).toEqual([]);
    // « Autre » without its text: refused.
    await card.getByLabel("Motif (interne)").selectOption("other");
    await waiver.click();
    await expect(
      greffe
        .getByRole("alert")
        .filter({ hasText: "Choisis un motif ; pour « autre », précise-le." }),
    ).toBeVisible();
    const motive = "Fond trop proche du visage";
    await card.getByLabel("Motif (interne)").selectOption("other");
    await card.getByLabel(/Précise le motif/).fill(motive);
    await waiver.click();
    await expect(greffe.getByText("Décision enregistrée.")).toBeVisible();
    await expect(card).toHaveCount(0);
    await greffe.context().close();

    const { data: pose } = await admin
      .from("photos")
      .select("status, is_cutout, cutout_waived, cutout_waived_reason, pending_path")
      .eq("owner_id", bad.id)
      .eq("position", 2)
      .single();
    expect(pose).toEqual({
      status: "approved",
      is_cutout: false,
      cutout_waived: true,
      cutout_waived_reason: `other: ${motive}`,
      pending_path: null,
    });
    const { data: logged } = await admin
      .from("moderation_actions")
      .select("action, reason, admin_id")
      .eq("target_user_id", bad.id);
    expect(logged).toEqual([
      { action: "photo_cutout_waive", reason: `other: ${motive}`, admin_id: greffier.id },
    ]);
    // The member is told the photo is validated, never the motive.
    const { data: told } = await admin
      .from("notifications")
      .select("payload")
      .eq("user_id", bad.id)
      .eq("type", "moderation_decision");
    expect(told).toEqual([{ payload: { photo_position: 2, approved: true, reason: null } }]);
    const page = await login(browser, bad.email, bad.password);
    await page.goto("/ma-fiche");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(motive);
    await expect(page.locator("body")).not.toContainText("sans détourage");
    await page.context().close();
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
    // Each Bad is a kraft folder (DecouverteDossiers.dc.html): pseudo, age, town, distance.
    const folder = page.getByRole("link", {
      name: `Ouvrir le dossier de ${bad.pseudo}, 30 ans · Port-Test · 0 km`,
    });
    await expect(folder).toBeVisible();
    await expect(folder).toContainText(bad.pseudo);
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-decouverte");

    // Opened, the folder fills the screen and its cover turns away on the Fiche, at its own URL.
    // A short window so the list scrolls: its position must survive the folder.
    await page.setViewportSize({ width: 390, height: 560 });
    await folder.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 40));
    const scrolled = await page.evaluate(() => Math.round(window.scrollY));
    expect(scrolled).toBeGreaterThan(0);
    const dossier = page.getByRole("dialog", { name: `Dossier de ${bad.pseudo}` });
    async function openFolder() {
      await folder.click();
      await page.waitForURL(new RegExp(`/fiche/${bad.id}$`));
      await expect(dossier).toBeVisible();
    }
    // The cover lives one second only: its turn is read by the page the moment it appears, not
    // afterwards (a slow device may already be removing it).
    await page.evaluate(() => {
      const w = window as unknown as { coverTurn?: number };
      new MutationObserver((_, observer) => {
        const cover = document.querySelector("[data-testid=dossier-cover]");
        if (!cover) return;
        w.coverTurn = parseFloat(getComputedStyle(cover).transitionDuration);
        observer.disconnect();
      }).observe(document.body, { childList: true, subtree: true });
    });
    await openFolder();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { coverTurn?: number }).coverTurn))
      .toBeCloseTo(0.9, 1);
    await expect(dossier).toHaveAttribute("data-phase", "2");
    await expect(dossier.getByTestId("placard-small")).toContainText(bad.pseudo);
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-dossier-ouvert");
    // « Fermer le dossier »: back to the list, scrolled as it was.
    await dossier.getByRole("button", { name: "Fermer le dossier" }).click();
    await page.waitForURL(/\/decouverte$/);
    await expect(dossier).toHaveCount(0);
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(scrolled);
    // The phone's back button does the same.
    await openFolder();
    await page.goBack();
    await page.waitForURL(/\/decouverte$/);
    await expect(dossier).toHaveCount(0);
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(scrolled);
    // With less motion asked, the folder opens at once, without the turning cover.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openFolder();
    await expect(dossier).toHaveAttribute("data-phase", "2", { timeout: 400 });
    await expect(page.getByTestId("dossier-cover")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: null });
    // The Fiche keeps its own URL: a reload (or a shared link) shows it on its own page.
    await page.reload();
    await expect(page.getByTestId("fiche")).toBeVisible();
    await expect(page.getByRole("dialog", { name: `Dossier de ${bad.pseudo}` })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 900 });

    // The Fiche v7 (FicheShow.dc.html): the 3 poses on the common wall, the small placard.
    await page.waitForURL(/\/fiche\//);
    const fiche = page.getByTestId("fiche");
    await expect(
      fiche.getByRole("heading", { level: 1, name: /^Dossier judiciaire/ }),
    ).toBeVisible();
    await expect(fiche.getByText("Photo signalétique · alignement 3 poses")).toBeVisible();
    await expect(fiche.getByText("100 %")).toBeVisible();
    await expect(
      fiche.getByText(/^Dossier n° \d{6} · page 1\/1 · quartier : Port-Test$/),
    ).toBeVisible();
    // Readable without opening it: pseudo, age · town · distance, signs, N° d'écrou, Agrandir.
    const small = fiche.getByTestId("placard-small");
    await expect(small).toContainText(bad.pseudo);
    await expect(small).toContainText("30 ans · Port-Test");
    await expect(small).toContainText(/N° \d{6}/);
    await expect(small).toContainText("Agrandir");
    // Low on the wall (9i): the bottom of its frame about 10 px above the bottom of the wall, and
    // within the bottom third of the middle pose (the framing guide keeps the face and shoulders
    // above 67 %), on a small and a large phone.
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 900 });
      // The new width applied first (WebKit may resize after the call returns), then the wall,
      // the placard and the middle pose measured in one layout pass, never across a resize.
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
      const box = await page.evaluate(() => {
        const rect = (id: string) =>
          document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect();
        const wall = rect("fiche-wall");
        const placard = rect("placard-small");
        const center = rect("pose-center");
        return {
          gap: wall.bottom - placard.bottom,
          placardTop: placard.top,
          clearLine: center.top + center.height * 0.67,
        };
      });
      expect(box.gap).toBeGreaterThanOrEqual(6);
      expect(box.gap).toBeLessThanOrEqual(14);
      expect(box.placardTop).toBeGreaterThanOrEqual(box.clearLine);
    }
    // Never the birth date, a real name or a height (SPEC §5).
    await expect(fiche.getByText(/1996|02\/03|cm\b|CONFIDENTIEL/)).toHaveCount(0);
    // No request without a bet; Signaler and Bloquer behind the flag.
    const bar = page.getByTestId("fiche-action");
    await expect(bar.getByText("Retourne la pancarte pour parier")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Demander une visite/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Signaler", exact: true })).toBeHidden();
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-fiche");

    // The poses: the frames stay, only the images change; a loop both ways.
    const center = fiche.getByTestId("pose-center");
    await expect(center).toHaveAttribute("data-pose", "face");
    await expect(center).toHaveAccessibleName(`${bad.pseudo}, pose au centre : face`);
    const wall = fiche.getByTestId("fiche-wall");
    async function swipe(dx: number) {
      // Measured at each gesture: a notice above may have moved the page since the last one.
      const box = (await wall.boundingBox())!;
      const y = box.y + 140;
      const x = box.x + box.width / 2;
      // The gesture starts on the wall itself, not on the placard (which keeps its touches).
      const start = await page.evaluate(
        ([px, py]) => {
          const target = document.elementFromPoint(px!, py!);
          return target?.closest("[data-testid=placard-small]")
            ? "placard"
            : target?.closest("[data-testid=fiche-wall]")
              ? "wall"
              : (target?.outerHTML.slice(0, 80) ?? "none");
        },
        [x, y],
      );
      expect(start).toBe("wall");
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx / 2, y, { steps: 4 });
      await page.mouse.move(x + dx, y, { steps: 4 });
      await page.mouse.up();
    }
    await swipe(-80);
    await expect(center).toHaveAttribute("data-pose", "right");
    await swipe(-80);
    await expect(center).toHaveAttribute("data-pose", "left");
    await swipe(-80);
    await expect(center).toHaveAttribute("data-pose", "face");
    await swipe(80);
    await expect(center).toHaveAttribute("data-pose", "left");
    // Below the threshold of 40 px, nothing moves.
    await swipe(25);
    await expect(center).toHaveAttribute("data-pose", "left");
    await swipe(-80);
    await expect(center).toHaveAttribute("data-pose", "face");
    // A touch on a side pose puts it in the centre.
    // Touched where the side pose shows (its outer part), as a finger would.
    const side = async (name: string, x: number) => {
      const button = fiche.getByRole("button", { name });
      const size = (await button.boundingBox())!;
      await button.click({ position: { x: size.width * x, y: size.height * 0.4 } });
    };
    await side("Mettre au centre : profil droit", 0.45);
    await expect(center).toHaveAttribute("data-pose", "right");
    // The right profile, validated without cut-out (9k): a print stapled to the wall, white
    // border and shadow, the size of the other poses; the others stay cut out on the wall.
    const printLayer = center.locator(".fiche-layer", { has: page.getByTestId("pose-print") });
    await expect(printLayer).toHaveCSS("opacity", "1");
    const print = printLayer.getByTestId("pose-print");
    await expect(print).toHaveCSS("border-top-color", "rgb(251, 248, 241)");
    expect(await print.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
    {
      const frame = (await center.boundingBox())!;
      const box = (await print.boundingBox())!;
      expect(box.width).toBeGreaterThan(frame.width * 0.9);
      expect(box.height).toBeGreaterThan(frame.height * 0.9);
    }
    // One print per frame (each frame holds the 3 poses as layers): only that pose.
    await expect(fiche.getByTestId("pose-print")).toHaveCount(3);
    await shot(page, "visitor-fiche-print");
    await side("Mettre au centre : face", 0.6);
    await expect(center).toHaveAttribute("data-pose", "face");
    expect(await wall.evaluate((el) => getComputedStyle(el).touchAction)).toBe("pan-y");
    // With less motion asked, the images change without a fade.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fade = await center
      .locator(".fiche-layer")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    expect(fade).toBeLessThan(0.01);
    await page.emulateMedia({ reducedMotion: null });

    // The placard grows over the bottom; the heads stay visible above it.
    await small.click();
    const zoom = page.getByRole("region", { name: `Pancarte de ${bad.pseudo}, agrandie` });
    await expect(zoom).toBeVisible();
    await expect(zoom.getByText("Signes distinctifs")).toBeVisible();
    await expect(zoom.getByText("Cherche")).toBeVisible();
    await expect(zoom.getByText("Points communs avec toi")).toBeVisible();
    await expect(zoom.getByText(/« Motarde, allergique/)).toBeVisible();
    const top = (await zoom.boundingBox())!.y;
    expect(top).toBeGreaterThan((await center.boundingBox())!.y + 60);
    await expect(zoom.getByRole("radio")).toHaveCount(0);
    // The photos still swipe while it is open.
    await swipe(-80);
    await expect(center).toHaveAttribute("data-pose", "right");
    await swipe(80);
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-fiche-pancarte");
    // Réduire, then Escape.
    await zoom.getByRole("button", { name: "Réduire la pancarte" }).click();
    await expect(zoom).toHaveCount(0);
    await expect(small).toBeFocused();
    await small.click();
    await page.keyboard.press("Escape");
    await expect(zoom).toHaveCount(0);
    await expect(small).toBeFocused();

    // The back: the 3 charges as radio buttons, « Valider mon pari » once one is ticked.
    await small.click();
    await zoom.getByRole("button", { name: "Retourner : chefs d'accusation" }).click();
    const charges = zoom.getByRole("group", { name: "Chefs d'accusation · 1 vrai · 2 faux" });
    await expect(charges.getByRole("radio")).toHaveCount(3);
    const validate = zoom.getByRole("button", { name: "Valider mon pari" });
    await expect(validate).toBeDisabled();
    await expect(zoom.getByRole("button", { name: "Retourner : chefs d'accusation" })).toHaveCount(
      0,
    );
    expect(await axeViolations(page)).toEqual([]);
    await charges.getByText(CHARGES[0]!).click();
    await charges.getByText(CHARGES[1]!).click();
    await expect(validate).toBeEnabled();
    await shot(page, "visitor-fiche-verso");
    // Nothing is recorded before the request is sent (rule 14).
    const { count: before } = await admin
      .from("visit_requests")
      .select("id", { count: "exact", head: true })
      .eq("visitor_id", visitor.id);
    expect(before).toBe(0);
    await validate.click();
    await expect(zoom).toHaveCount(0);
    const ask = bar.getByRole("button", { name: "Demander une visite · pari n° 2" });
    await expect(ask).toBeFocused();
    // The buttons take the colour of the connected member's gender (a man: gold), what
    // represents the Bad takes hers (red) (PARCOURS-DESIGN §1).
    await page.mouse.move(0, 0); // not hovered: the colour at rest
    await expect(ask).toHaveCSS("background-color", "rgb(212, 164, 55)");
    await expect(small).toBeVisible();
    await expect(fiche).toHaveAttribute("data-accent", "red");

    // A non-binary Visitor: the same buttons in cream, the Bad's placard still red; AA (axe).
    await admin.from("profiles").update({ gender: "non_binary" }).eq("id", visitor.id);
    await admin
      .from("profiles")
      .update({ seeking_genders: ["man", "non_binary"] })
      .eq("id", bad.id);
    await page.reload();
    await small.click();
    await zoom.getByRole("button", { name: "Retourner : chefs d'accusation" }).click();
    await charges.getByText(CHARGES[0]!).click();
    await page.mouse.move(0, 0); // not hovered: the colour at rest
    await expect(validate).toHaveCSS("background-color", "rgb(242, 232, 213)");
    await validate.click();
    const askCream = bar.getByRole("button", { name: "Demander une visite · pari n° 1" });
    await page.mouse.move(0, 0); // not hovered: the colour at rest
    await expect(askCream).toHaveCSS("background-color", "rgb(242, 232, 213)");
    await expect(fiche).toHaveAttribute("data-accent", "red");
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-fiche-bouton-creme");
    await admin.from("profiles").update({ gender: "man" }).eq("id", visitor.id);
    await admin
      .from("profiles")
      .update({ seeking_genders: ["man"] })
      .eq("id", bad.id);

    // A full Parloir: the button says so, disabled.
    await admin.from("profiles").update({ requests_closed_manual: true }).eq("id", bad.id);
    await page.reload();
    await expect(bar.getByRole("button", { name: "Parloir complet" })).toBeDisabled();
    await admin.from("profiles").update({ requests_closed_manual: false }).eq("id", bad.id);
    await page.reload();

    // La Demande de parloir opens with the bet validated on the placard, still changeable.
    await small.click();
    await zoom.getByRole("button", { name: "Retourner : chefs d'accusation" }).click();
    await charges.getByText(CHARGES[1]!).click();
    await validate.click();
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
    // A large screen: the same composition, centred.
    await page.setViewportSize({ width: 1280, height: 900 });
    const centered = (await center.boundingBox())!;
    expect(Math.abs(centered.x + centered.width / 2 - 640)).toBeLessThan(40);
    expect(await axeViolations(page)).toEqual([]);
    await shot(page, "visitor-fiche-large");
    await page.setViewportSize({ width: 390, height: 900 });

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
    await expect(own.getByTestId("placard-small")).toContainText(bad.pseudo);
    await own.getByTestId("placard-small").click();
    const ownZoom = page.getByRole("region", { name: /agrandie$/ });
    await ownZoom.getByRole("button", { name: "Retourner : chefs d'accusation" }).click();
    await expect(
      ownZoom.getByRole("heading", { name: "Chefs d'accusation · 1 vrai · 2 faux" }),
    ).toBeVisible();
    await expect(ownZoom.getByRole("listitem")).toHaveText(CHARGES.map((c, i) => `${i + 1}. ${c}`));
    await expect(ownZoom.getByRole("radio")).toHaveCount(0);
    await expect(ownZoom.getByRole("button", { name: "Valider mon pari" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Demander une visite/ })).toHaveCount(0);
    await expect(
      page.getByText("C'est ta Fiche, telle que les Visiteurs la voient."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Signaler ou bloquer" })).toHaveCount(0);
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
    // Signaler and Bloquer, behind the flag (one touch, then the existing flows).
    await page.getByRole("button", { name: "Signaler ou bloquer" }).click();
    await page.getByRole("button", { name: "Signaler", exact: true }).click();
    const report = page.getByRole("dialog", { name: /Signaler/ });
    await report.getByLabel("Faux profil").check();
    expect(await axeViolations(page)).toEqual([]);
    await report.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(report.getByText(/Merci. Le Greffe va regarder/)).toBeVisible();
    await report.getByRole("button", { name: "Fermer" }).first().click();

    await page.getByRole("button", { name: "Bloquer", exact: true }).click();
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
