import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { openGreffe } from "./helpers/admin";
import { FakePushService } from "./helpers/fake-push-service";
import { auditSignedIn, LIGHTHOUSE_CATEGORIES } from "./helpers/lighthouse";
import { cutoutReady, onboardBad, onboardVisitor, signUp } from "./helpers/onboarding";
import { settled } from "./helpers/settle";
import { captcha } from "./helpers/captcha";

// THE end-to-end journey, LOCAL STACK ONLY (scripts/ci/local-env.mjs). Owner's rule (2026-10-07):
// every later phase extends it (visit, Parloir, Permis permanent, Cavale) before it is done.
//   1. A Bad and a Visitor sign up for real (landing door, form, confirmation e-mail read in
//      Mailpit) and go through the whole onboarding on screen, in Toulon (Phase 8d).
//   2. A test admin opens /admin/greffe with the second factor and validates the 4 photos
//      (copy to the public storage included).
//   3. Toulon is opened (local database only); the Bad is visible to the Visitor (can_view_bad),
//      who finds the Fiche in the Découverte and files a Demande de parloir.
//   4. The Bad accepts it in the Courrier by sending 2 Heures de visite (Phase 5b).
//   5. The Visitor chooses one of them in « Mes demandes »: the visit is scheduled, both see it
//      in the Tableau des visites.
//   6. The visit time comes (moved to « now », local database only): both enter the Parloir, the
//      bet is revealed once both are there, then the messages (contacts masked).
//   7. The 30 minutes end: both choose « Prolonger » in secret → Permis permanent.
//   8. Le Parloir sans horaire: the conversation goes on without a visit.
//   9. La Cavale; 9 bis Lighthouse (on demand); 9 ter axe and keyboard on every page.
//  10. The notifications leave through /api/cron/push to a fake push service.
//  11. Bloquer in the Parloir. 12. The Visitor deletes their account, for real (Phase 8d).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const dbUrl = process.env.SUPABASE_DB_URL ?? "";
const mailpit = process.env.MAILPIT_URL ?? "";
const cronSecret = process.env.PUSH_CRON_SECRET ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  /@(127\.0\.0\.1|localhost):/.test(dbUrl) &&
  [publishable, secret, cronSecret, mailpit].every((value) => value !== "") &&
  Boolean(process.env.PUSH_TEST_TLS_CERT);

const CHARGES = [
  "A traversé la Corse à vélo sans jamais regarder une carte.",
  "A été figurante dans un clip de rap marseillais.",
  "Collectionne les cartes postales de phares.",
];

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function axeViolations(page: Page) {
  await settled(page);
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return result.violations.map(
    (v) =>
      `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} (${n.failureSummary ?? ""})`).join(", ")}`,
  );
}

/** SQL as the database owner, local stack only; returns the single value printed. */
function asOwner(sql: string): string {
  return execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

/** Uncaught exceptions and console errors of the pages of the current step (printed if it fails). */
const pageErrors: string[] = [];

async function login(browser: Browser, email: string, password: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.on("pageerror", (error) => pageErrors.push(`pageerror: ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(`console.error: ${message.text()}`);
  });
  await page.goto("/connexion");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((target) => !/^\/(connexion|onboarding)$/.test(target.pathname));
  // Landing on a photo page (Ma Fiche) by a client-side navigation: it may load itself again once
  // (components/onboarding/cutout-choice.tsx); wait for it before going anywhere else.
  if ((await page.locator("[data-cutout-engine]").count()) > 0) await cutoutReady(page);
  return page;
}

test.describe("journey: Greffe → Demande → Heures de visite → Parloir → Permis permanent → notifications (local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test.afterEach(({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus && pageErrors.length > 0) {
      console.log(`[${testInfo.project.name}] ${testInfo.title}\n${pageErrors.join("\n")}`);
    }
    pageErrors.length = 0;
  });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const push = new FakePushService();
  const tag = randomBytes(2).toString("hex");
  type Member = { email: string; password: string; id: string; pseudo: string };
  const bad: Member = { email: "", password: "", id: "", pseudo: `Lune${tag}` };
  const visitor: Member = { email: "", password: "", id: "", pseudo: `Nox${tag}` };
  const greffier: { email: string; password: string; id: string; totpSecret?: string } = {
    email: "",
    password: "",
    id: "",
  };
  const endpoints = { bad: "", visitor: "" };
  const files: { published: string[] } = { published: [] };

  async function account() {
    const email = `e2e-journey-${randomBytes(4).toString("hex")}@example.com`;
    const password = `Pw-${randomBytes(12).toString("base64url")}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    return { email, password, id: data.user.id };
  }

  /** The member's browser subscribes to the fake push service (same function as the app). */
  async function subscribe(target: Member): Promise<string> {
    const client = createClient(url, publishable, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({
      email: target.email,
      password: target.password,
      options: captcha,
    });
    if (signedIn.error) throw signedIn.error;
    const browser = push.newBrowser();
    const { error } = await client.rpc("save_push_subscription", {
      p_endpoint: browser.endpoint,
      p_p256dh: browser.p256dh,
      p_auth: browser.auth,
      p_locale: "fr",
    });
    if (error) throw error;
    return browser.endpoint;
  }

  test.beforeAll(async () => {
    await push.start();
    for (const target of [bad, visitor]) {
      target.email = `e2e-journey-${randomBytes(4).toString("hex")}@example.com`;
      target.password = `Pw-${randomBytes(12).toString("base64url")}`;
    }
    Object.assign(greffier, await account());
    asOwner(
      `insert into public.admin_users (user_id, note) values ('${greffier.id}', 'e2e journey')`,
    );
  });

  test.afterAll(async () => {
    asOwner("update public.launch_zones set status = 'waitlist' where slug = 'toulon'");
    if (files.published.length) await admin.storage.from("photos").remove(files.published);
    // Files still waiting at the Greffe (a run stopped before step 2).
    for (const id of [bad.id, visitor.id].filter(Boolean)) {
      const { data: pending } = await admin.storage.from("photos-pending").list(id);
      if (pending?.length)
        await admin.storage.from("photos-pending").remove(pending.map((f) => `${id}/${f.name}`));
    }
    for (const id of [bad.id, visitor.id, greffier.id])
      if (id) await admin.auth.admin.deleteUser(id);
    await push.stop();
  });

  test("1. a Bad and a Visitor sign up and go through their onboarding", async ({ browser }) => {
    test.setTimeout(180_000);
    const badPage = await (await browser.newContext()).newPage();
    await signUp(badPage, "Je suis Bad", bad, mailpit);
    await onboardBad(badPage, bad.pseudo, CHARGES);
    await badPage.context().close();
    const visitorPage = await (await browser.newContext()).newPage();
    // The Visitor comes through the Bad's referral link (« Complices recrutés », Phase 9c).
    const referral = asOwner(
      `select p.referral_code from public.profiles p join auth.users u on u.id = p.id
       where u.email = '${bad.email}'`,
    );
    await signUp(visitorPage, "Je viens visiter", visitor, mailpit, referral);
    await onboardVisitor(
      visitorPage,
      visitor.pseudo,
      "Motard du dimanche, je préfère les phares aux bars bondés.",
    );
    await visitorPage.context().close();

    for (const target of [bad, visitor]) {
      target.id = asOwner(`select id from auth.users where email = '${target.email}'`);
      expect(target.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(
      asOwner(
        `select string_agg(role || ':' || (onboarding_completed_at is not null), ',' order by role)
         from public.profiles where id in ('${bad.id}', '${visitor.id}')`,
      ),
    ).toBe("bad:true,visitor:true");
    // The true charge is the first one written (the bet of step 3 relies on it).
    expect(
      asOwner(
        `select (array[charge_1, charge_2, charge_3])[true_index] from public.casier_charges
         where profile_id = '${bad.id}'`,
      ),
    ).toBe(CHARGES[0]);
    expect(
      asOwner(`select count(*) from public.photos where owner_id in ('${bad.id}', '${visitor.id}')
               and status = 'pending'`),
    ).toBe("4");
    endpoints.bad = await subscribe(bad);
    endpoints.visitor = await subscribe(visitor);
  });

  test("2. the Greffe validates the 4 photos (second factor, copy to the public storage)", async ({
    browser,
  }) => {
    const page = await (await browser.newContext()).newPage();
    greffier.totpSecret = await openGreffe(page, greffier);
    const card = (pseudo: string, pose: string) =>
      page
        .getByRole("listitem")
        .filter({ hasText: pseudo })
        .filter({ has: page.locator("p", { hasText: new RegExp(`· ${pose}$`) }) });
    for (const [pseudo, pose] of [
      [visitor.pseudo, "Face"],
      [bad.pseudo, "Face"],
      [bad.pseudo, "Profil gauche"],
      [bad.pseudo, "Profil droit"],
    ] as const) {
      await card(pseudo, pose).getByRole("button", { name: "Valider", exact: true }).click();
      await expect(card(pseudo, pose)).toHaveCount(0);
    }
    await page.context().close();

    const { data: photos } = await admin
      .from("photos")
      .select("status, pending_path, public_path_large, public_path_small")
      .in("owner_id", [bad.id, visitor.id]);
    expect(photos).toHaveLength(4);
    for (const photo of photos ?? []) {
      expect(photo.status).toBe("approved");
      expect(photo.pending_path).toBeNull();
      for (const path of [photo.public_path_large!, photo.public_path_small!]) {
        files.published.push(path);
        // The copy is really in the public bucket, under a random name (never the owner id).
        expect(path).not.toContain(bad.id);
        expect(path).not.toContain(visitor.id);
        const response = await fetch(`${url}/storage/v1/object/public/photos/${path}`);
        expect(response.status, path).toBe(200);
      }
    }
  });

  test("3. Toulon open: the Visitor sees the Fiche in the Découverte and files a Demande", async ({
    browser,
  }) => {
    asOwner("update public.launch_zones set status = 'open' where slug = 'toulon'");
    expect(asOwner(`select public.can_view_bad('${visitor.id}', '${bad.id}')`)).toBe("t");

    const page = await login(browser, visitor.email, visitor.password);
    await page.goto("/decouverte");
    await expect(page.getByRole("heading", { name: "La Découverte" })).toBeVisible();
    await page
      .getByRole("link", { name: new RegExp(bad.pseudo) })
      .first()
      .click();
    await page.waitForURL(/\/fiche\//);
    // The bet on the back of the placard, validated, handed to the Demande de parloir.
    await page.getByTestId("placard-small").click();
    await expect(page.getByText(/1 complice recruté/)).toBeVisible();
    await page.getByRole("button", { name: "Retourner : chefs d'accusation" }).click();
    await page
      .getByRole("group", { name: /1 vrai · 2 faux/ })
      .getByText(CHARGES[0]!)
      .click();
    await page.getByRole("button", { name: "Valider mon pari" }).click();
    await page.getByRole("button", { name: /^Demander une visite · pari n° \d$/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio", { name: new RegExp(CHARGES[0]!) })).toBeChecked();
    await dialog.getByRole("button", { name: /^« / }).first().click();
    await dialog.getByRole("button", { name: "Déposer ma demande" }).click();
    await expect(dialog.getByRole("heading", { name: "Demande déposée au Parloir" })).toBeVisible();
    await page.context().close();
  });

  test("4. the Bad accepts it in the Courrier with 2 Heures de visite", async ({ browser }) => {
    const page = await login(browser, bad.email, bad.password);
    await page.goto("/courrier");
    await page.getByRole("link", { name: new RegExp(visitor.pseudo) }).click();
    await page.getByRole("link", { name: "Accepter la visite" }).click();
    await expect(page.getByRole("heading", { name: "Tes Heures de visite" })).toBeVisible();
    await page.getByRole("button", { name: /^Demain soir/ }).click();
    await page.getByRole("button", { name: "+ Choisir un autre jour et une autre heure" }).click();
    // Two days ahead: the first possible half hour of today is valid only until the next half
    // hour, so the default choice could be refused (slot_too_soon) when the clock passes it.
    await page.getByLabel("Jour").selectOption({ index: 2 });
    await page.getByRole("button", { name: "Ajouter ce créneau" }).click();
    await expect(page.getByText("Tes créneaux (2 sur 3)")).toBeVisible();
    await page.getByRole("button", { name: "Envoyer mes Heures de visite" }).click();
    await expect(page.getByText(/Heures de visite envoyées/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tes créneaux" })).toBeVisible();
    await page.context().close();
    const { data } = await admin
      .from("visit_requests")
      .select("id, status, slots_round, choose_deadline")
      .eq("bad_id", bad.id)
      .eq("visitor_id", visitor.id)
      .single();
    expect(data?.status).toBe("accepted");
    expect(data?.slots_round).toBe(1);
    expect(data?.choose_deadline).not.toBeNull();
    const { data: slots } = await admin
      .from("visit_slots")
      .select("status")
      .eq("request_id", data!.id);
    expect(slots?.map((slot) => slot.status)).toEqual(["offered", "offered"]);
  });

  test("5. the Visitor chooses a slot: the visit is scheduled", async ({ browser }) => {
    const page = await login(browser, visitor.email, visitor.password);
    await page.goto("/demandes");
    await expect(page.getByRole("img", { name: /visite acceptée/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Les Heures de visite" })).toBeVisible();
    const offered = page.getByRole("group", { name: "Les Heures de visite" }).getByRole("button");
    await expect(offered).toHaveCount(2);
    const label = (await offered.first().textContent()) ?? "";
    await offered.first().click();
    await expect(offered.first()).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: `Confirmer : ${label}` }).click();
    await expect(page.getByText(`Visite programmée avec ${bad.pseudo}`)).toBeVisible();

    // Le Tableau des visites, on both sides.
    await page.goto("/visites");
    await expect(page.getByRole("heading", { name: "Tableau des visites" })).toBeVisible();
    await expect(page.getByText(label)).toBeVisible();
    await expect(page.getByText(`avec ${bad.pseudo}`)).toBeVisible();
    await page.context().close();

    const { data: visits } = await admin
      .from("visits")
      .select("status, slot_id, starts_at, ends_at")
      .eq("bad_id", bad.id)
      .eq("visitor_id", visitor.id);
    expect(visits).toHaveLength(1);
    expect(visits?.[0]?.status).toBe("scheduled");
    const minutes =
      (new Date(visits![0]!.ends_at).getTime() - new Date(visits![0]!.starts_at).getTime()) /
      60_000;
    expect(minutes).toBe(30);
    const { data: slots } = await admin
      .from("visit_slots")
      .select("id, status")
      .eq("id", visits![0]!.slot_id);
    expect(slots?.[0]?.status).toBe("chosen");

    const badPage = await login(browser, bad.email, bad.password);
    await badPage.goto("/visites");
    await expect(badPage.getByText(label)).toBeVisible();
    await expect(badPage.getByText(`avec ${visitor.pseudo}`)).toBeVisible();
    await badPage.context().close();
  });

  test("6. the visit: both in the Parloir, the bet revealed, messages", async ({ browser }) => {
    asOwner(
      `update public.visits set starts_at = now() - interval '1 minute', ends_at = now() + interval '29 minutes'
       where visitor_id = '${visitor.id}' and status = 'scheduled'`,
    );
    asOwner("select public.run_parloir_ticks()");
    const visitId = asOwner(`select id from public.visits where visitor_id = '${visitor.id}'`);

    const visitorPage = await login(browser, visitor.email, visitor.password);
    await visitorPage.goto("/visites");
    await visitorPage.getByRole("link", { name: "Entrer au Parloir" }).click();
    await visitorPage.waitForURL(new RegExp(`/visites/${visitId}$`));
    await expect(visitorPage.getByRole("heading", { name: /PARLOIR · CABINE \d\d/ })).toBeVisible();
    await expect(visitorPage.getByText(`En attente de ${bad.pseudo}…`)).toBeVisible();

    const badPage = await login(browser, bad.email, bad.password);
    await badPage.goto(`/visites/${visitId}`);
    // Both present: the bet opens the conversation (the Visitor bet on the true charge).
    await expect(badPage.getByText(`LE PARI DE ${visitor.pseudo.toUpperCase()}`)).toBeVisible();
    await expect(badPage.getByRole("img", { name: /bien vu/i })).toBeVisible();
    await expect(badPage.getByText(`« ${CHARGES[0]} »`)).toBeVisible();
    // The page a member is looking at (WebKit slows the timers of a page in the background).
    await visitorPage.bringToFront();
    await expect(visitorPage.getByText(`LE PARI DE ${visitor.pseudo.toUpperCase()}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(visitorPage.getByRole("timer").first()).toHaveText(/^\d\d:\d\d$/);
    expect(await axeViolations(visitorPage)).toEqual([]);

    // « … écrit » (9l): the Bad sees the Visitor typing, through the private Broadcast channel of
    // the conversation (nothing written in the database), announced once to screen readers.
    const field = visitorPage.getByPlaceholder("Ton message");
    await field.click();
    await field.pressSequentially("Ta meilleure balade de nuit ?", { delay: 40 });
    await badPage.bringToFront();
    const typing = badPage.getByTestId("typing");
    await expect(typing).toHaveText(`${visitor.pseudo} écrit…`, { timeout: 15_000 });
    await expect(typing).toHaveAttribute("aria-live", "polite");
    await field.pressSequentially(" Mon 06 12 34 56 78");
    // Sent at once on the Visitor's screen (« Envoi… » until the server answers), then once only.
    await visitorPage.bringToFront();
    await visitorPage.getByRole("button", { name: "Envoyer" }).click();
    await expect(field).toHaveValue("");
    const sent = visitorPage
      .getByRole("list", { name: "Conversation" })
      .getByText(/^Ta meilleure balade de nuit \? Mon/);
    await expect(sent).toHaveCount(1);
    await expect(visitorPage.locator("[data-pending]")).toHaveCount(0, { timeout: 15_000 });
    await expect(sent).toHaveCount(1);
    await expect(sent).toHaveText("Ta meilleure balade de nuit ? Mon [•••]");
    // The sending ends « … écrit » at once on the Bad's screen.
    await badPage.bringToFront();
    await expect(badPage.getByText("Ta meilleure balade de nuit ? Mon [•••]")).toBeVisible({
      timeout: 15_000,
    });
    await expect(typing).toHaveText("", { timeout: 6_000 });
    // The hour under each message (HH:mm, the member's time zone) and the day.
    const received = badPage
      .locator("[data-message-id]")
      .filter({ hasText: "Ta meilleure balade de nuit ?" });
    await expect(received.getByText(/^\d\d:\d\d$/)).toBeVisible();
    await expect(
      badPage.getByTestId("day-separator").filter({ hasText: "Aujourd'hui" }),
    ).toBeVisible();
    expect(await axeViolations(badPage)).toEqual([]);

    // A failed sending stays on screen with « Réessayer »; retried, it arrives once.
    await badPage.route("**/visites/**", async (route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await badPage.getByPlaceholder("Ton message").fill("Le long de la mer, jusqu'au phare.");
    await badPage.getByRole("button", { name: "Envoyer" }).click();
    const failed = badPage.locator('[data-pending="failed"]');
    await expect(failed).toContainText("Non envoyé", { timeout: 15_000 });
    await badPage.unroute("**/visites/**");
    await failed.getByRole("button", { name: "Réessayer" }).click();
    await expect(badPage.locator("[data-pending]")).toHaveCount(0, { timeout: 15_000 });
    await expect(
      badPage
        .getByRole("list", { name: "Conversation" })
        .getByText("Le long de la mer, jusqu'au phare."),
    ).toHaveCount(1);
    await visitorPage.bringToFront();
    await expect(visitorPage.getByText("Le long de la mer, jusqu'au phare.")).toBeVisible({
      timeout: 15_000,
    });
    await visitorPage.context().close();
    await badPage.context().close();

    const bet = JSON.parse(
      asOwner(`select system_payload from public.messages m join public.visits v on v.conversation_id = m.conversation_id
               where v.id = '${visitId}' and m.system_payload ->> 'type' = 'bet'`),
    ) as { correct: boolean; charge: string };
    expect(bet).toMatchObject({ correct: true, charge: CHARGES[0] });
    expect(
      asOwner(`select count(*) from public.messages m join public.visits v on v.conversation_id = m.conversation_id
               where v.id = '${visitId}' and m.kind = 'text'`),
    ).toBe("2");
    expect(
      asOwner(
        `select bad_joined_at is not null and visitor_joined_at is not null from public.visits where id = '${visitId}'`,
      ),
    ).toBe("t");
  });

  test("7. the end of the visit: both prolong in secret → Permis permanent", async ({
    browser,
  }) => {
    const visitId = asOwner(`select id from public.visits where visitor_id = '${visitor.id}'`);
    asOwner(
      `update public.visits set starts_at = now() - interval '31 minutes', ends_at = now() - interval '1 minute'
       where id = '${visitId}'`,
    );
    asOwner("select public.run_parloir_ticks()");
    expect(asOwner(`select status from public.visits where id = '${visitId}'`)).toBe("ended");

    const visitorPage = await login(browser, visitor.email, visitor.password);
    await visitorPage.goto(`/visites/${visitId}`);
    await expect(
      visitorPage.getByRole("heading", { name: `Et maintenant, avec ${bad.pseudo} ?` }),
    ).toBeVisible();
    expect(await axeViolations(visitorPage)).toEqual([]);
    await visitorPage.getByRole("button", { name: "Prolonger" }).click();
    await expect(visitorPage.getByText(/Ton choix est enregistré/)).toBeVisible();

    const badPage = await login(browser, bad.email, bad.password);
    await badPage.goto("/visites");
    await badPage.getByRole("link", { name: "Fin de visite : à toi de choisir" }).click();
    await expect(
      badPage.getByRole("heading", { name: `Et maintenant, avec ${visitor.pseudo} ?` }),
    ).toBeVisible();
    // The Visitor's choice is never shown to the Bad.
    expect((await badPage.locator("main").textContent()) ?? "").not.toMatch(/enregistré|prolongé/i);
    await badPage.getByRole("button", { name: "Prolonger" }).click();
    await expect(badPage.getByRole("img", { name: /permis permanent/i })).toBeVisible();
    await visitorPage.bringToFront();
    await expect(visitorPage.getByRole("img", { name: /permis permanent/i })).toBeVisible({
      timeout: 15_000,
    });
    await visitorPage.context().close();
    await badPage.context().close();

    expect(asOwner(`select outcome from public.visits where id = '${visitId}'`)).toBe("released");
    expect(
      asOwner(`select r.status || '/' || c.status from public.visit_requests r join public.conversations c on c.request_id = r.id
               where r.visitor_id = '${visitor.id}' and r.bad_id = '${bad.id}'`),
    ).toBe("released/open");
  });

  test("8. le Parloir sans horaire: the conversation goes on", async ({ browser }) => {
    const badPage = await login(browser, bad.email, bad.password);
    await badPage.goto("/visites");
    await badPage.getByRole("link", { name: `Permis permanent avec ${visitor.pseudo}` }).click();
    await badPage.waitForURL(/\/visites\/parloir\//);
    await expect(badPage.getByRole("heading", { name: "PARLOIR · SANS HORAIRE" })).toBeVisible();
    // The messages of the visit stay at the top.
    await expect(badPage.getByText("Le long de la mer, jusqu'au phare.")).toBeVisible();
    await badPage.getByPlaceholder("Ton message").fill("On se refait ça quand tu veux.");
    await badPage.getByRole("button", { name: "Envoyer" }).click();
    await expect(badPage.getByText("On se refait ça quand tu veux.")).toBeVisible();
    await expect(badPage.getByRole("link", { name: "Conseils sécurité" })).toBeVisible();
    // « Affaire classée » is no longer between the messages and the field (9l): it is in the
    // « ⋯ » of the plate, with Signaler and Bloquer, and keeps its confirmation.
    await expect(badPage.getByRole("button", { name: /Affaire classée/ })).toHaveCount(0);
    const plate = badPage.getByRole("button", {
      name: `Actions du Parloir avec ${visitor.pseudo}`,
    });
    await expect(plate).toHaveAttribute("aria-expanded", "false");
    await plate.click();
    await expect(plate).toHaveAttribute("aria-expanded", "true");
    await expect(badPage.getByRole("button", { name: "Signaler", exact: true })).toBeVisible();
    await expect(badPage.getByRole("button", { name: "Bloquer", exact: true })).toBeVisible();
    expect(await axeViolations(badPage)).toEqual([]);
    await badPage.getByRole("button", { name: /Affaire classée/ }).click();
    const confirm = badPage.getByRole("dialog", {
      name: `Classer l'affaire avec ${visitor.pseudo} ?`,
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Annuler" }).click();
    await expect(confirm).toHaveCount(0);
    // Escape closes the menu and gives the focus back to its button.
    await plate.click();
    await badPage.keyboard.press("Escape");
    await expect(plate).toHaveAttribute("aria-expanded", "false");
    await expect(plate).toBeFocused();
    expect(await axeViolations(badPage)).toEqual([]);
    // Not read yet: no « Lu » under the Bad's message.
    await expect(badPage.getByText("Lu", { exact: true })).toHaveCount(0);

    // The Visitor: one unread message, on the « Visites » tab and on the Parloir (Phase 6a).
    const visitorPage = await login(browser, visitor.email, visitor.password);
    await visitorPage.goto("/visites");
    const tabs = visitorPage.getByRole("navigation", { name: "Navigation principale" });
    await expect(tabs.getByRole("link", { name: /Visites.*1 message non lu/ })).toBeVisible();
    const parloir = visitorPage.getByRole("link", { name: `Permis permanent avec ${bad.pseudo}` });
    await expect(parloir).toContainText("1 non lu");
    // The messages of the visit, moved back two days: one separator per day (9l).
    asOwner(
      `update public.messages set created_at = created_at - interval '2 days'
       where conversation_id = (select id from public.conversations where visitor_id = '${visitor.id}')
         and body is distinct from 'On se refait ça quand tu veux.'`,
    );
    await parloir.click();
    await expect(visitorPage.getByText("On se refait ça quand tu veux.")).toBeVisible();
    // « Nouveaux messages » right above the one not read yet.
    const marker = visitorPage.getByTestId("new-messages");
    await expect(marker).toHaveText("Nouveaux messages");
    const unread = visitorPage
      .locator("[data-message-id]")
      .filter({ hasText: "On se refait ça quand tu veux." });
    expect(await marker.evaluate((el) => el.nextElementSibling?.textContent ?? "")).toContain(
      "On se refait ça quand tu veux.",
    );
    await expect(unread.getByText(/^\d\d:\d\d$/)).toBeVisible();
    const days = visitorPage.getByTestId("day-separator");
    await expect(days).toHaveCount(2);
    await expect(days.first()).toHaveText(
      /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) \d{1,2} [a-zéû]+$/,
    );
    await expect(days.last()).toHaveText("Aujourd'hui");
    // The safety note in full the first time.
    await expect(
      visitorPage.getByText("Premier rendez-vous : lieu public, préviens un proche."),
    ).toBeVisible();

    // Signaler a message (9l): no link under each message any more; a long press on the bubble
    // (touch screen) or its « ⋯ » button (keyboard) opens the same report.
    await expect(visitorPage.getByRole("button", { name: "Signaler", exact: true })).toHaveCount(0);
    const bubble = unread.getByTestId("reportable-message");
    const box = (await bubble.boundingBox())!;
    const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
    await bubble.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, ...at });
    await visitorPage.waitForTimeout(700);
    await bubble.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true, ...at });
    const report = visitorPage.getByRole("dialog", {
      name: `Signaler un message de ${bad.pseudo}`,
    });
    await expect(report).toBeVisible();
    await visitorPage.keyboard.press("Escape");
    await expect(report).toHaveCount(0);
    // A short touch does nothing.
    await bubble.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, ...at });
    await bubble.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true, ...at });
    await visitorPage.waitForTimeout(700);
    await expect(report).toHaveCount(0);
    const dots = unread.getByRole("button", { name: `Signaler ce message de ${bad.pseudo}` });
    await dots.focus();
    await visitorPage.keyboard.press("Enter");
    await expect(report).toBeVisible();
    expect(await axeViolations(visitorPage)).toEqual([]);
    // Not sent here: an open report between them would keep the contacts masked after the
    // Cavale (step 9). It is sent in step 11, before Bloquer.
    await visitorPage.keyboard.press("Escape");
    await expect(report).toHaveCount(0);
    // Read: the counter goes, and « Lu » appears under the Bad's message.
    // Opening the Parloir reads it, on the server, up to the Bad's new message (it was read up to
    // the visit before: the check is on that message, not on « something read »).
    const { data: conv } = await admin
      .from("conversations")
      .select("id, visitor_read_id")
      .eq("visitor_id", visitor.id)
      .single();
    const { data: newest } = await admin
      .from("messages")
      .select("id")
      .eq("conversation_id", conv!.id)
      .eq("sender_id", bad.id)
      .order("id", { ascending: false })
      .limit(1)
      .single();
    expect(conv!.visitor_read_id).toBeGreaterThanOrEqual(newest!.id);
    // Back to the Tableau with the browser's « back »: the router's cached copy is read again.
    await visitorPage.goBack();
    await visitorPage.waitForURL(/\/visites$/);
    await expect(parloir).not.toContainText("non lu");
    await expect(tabs.getByRole("link", { name: /non lu/ })).toHaveCount(0);
    // Opened again: everything read, no « Nouveaux messages »; the safety note is folded into one
    // line (remembered for this conversation), and opens again on a touch.
    await parloir.click();
    await expect(visitorPage.getByText("On se refait ça quand tu veux.")).toBeVisible();
    await expect(visitorPage.getByTestId("new-messages")).toHaveCount(0);
    const folded = visitorPage.getByRole("button", { name: /Sécurité : lieu public/ });
    await expect(folded).toBeVisible();
    await expect(folded).toHaveAttribute("aria-expanded", "false");
    expect((await folded.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await folded.click();
    await expect(
      visitorPage.getByText("Premier rendez-vous : lieu public, préviens un proche."),
    ).toBeVisible();
    await visitorPage.context().close();

    await badPage.reload();
    await expect(badPage.getByText("Lu", { exact: true })).toBeVisible();
    await badPage.context().close();
  });

  // Phase 9b [P1]: 48 h after the Permis permanent, quiet for 24 h, no Cavale yet (moved back in
  // time, local database only): « Toujours là ? », once per member.
  test("8 bis. the relance « Toujours là ? », once", async ({ browser }) => {
    asOwner(
      `update public.conversations set released_at = now() - interval '49 hours',
         last_message_at = now() - interval '25 hours'
       where visitor_id = '${visitor.id}' and bad_id = '${bad.id}'`,
    );
    const nudge = "Toujours là ? Propose une Cavale ou classe l'affaire.";
    const page = await login(browser, visitor.email, visitor.password);
    await page.goto("/visites");
    await page.getByRole("link", { name: `Permis permanent avec ${bad.pseudo}` }).click();
    await page.waitForURL(/\/visites\/parloir\//);
    await expect(page.getByText(nudge)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await expect
      .poll(() =>
        asOwner(
          `select visitor_nudged_at is not null from public.conversations
           where visitor_id = '${visitor.id}' and bad_id = '${bad.id}'`,
        ),
      )
      .toBe("t");
    await page.reload();
    await expect(page.getByRole("heading", { name: "PARLOIR · SANS HORAIRE" })).toBeVisible();
    await expect(page.getByText(nudge)).toHaveCount(0);
    await page.context().close();
  });

  test("9. la Cavale: proposed, another proposal, accepted; contacts in clear after it", async ({
    browser,
  }) => {
    // Both accounts older than 7 days (SPEC §10): only then does an accepted Cavale lift the masking.
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600_000).toISOString();
    await admin.from("profiles").update({ created_at: tenDaysAgo }).in("id", [bad.id, visitor.id]);
    const tomorrow = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(Date.now() + 24 * 3600_000));

    const open = async (page: Page, pseudo: string) => {
      await page.goto("/visites");
      await page.getByRole("link", { name: `Permis permanent avec ${pseudo}` }).click();
      await page.waitForURL(/\/visites\/parloir\//);
    };

    // The Bad proposes « chez moi »: a warning, not a refusal.
    const badPage = await login(browser, bad.email, bad.password);
    await open(badPage, visitor.pseudo);
    await badPage.getByRole("button", { name: /^Proposer une Cavale/ }).click();
    const form = badPage.getByRole("dialog", { name: "Proposer une Cavale" });
    await form.getByLabel("Nom du lieu").fill("Chez moi, 12 rue des Lilas");
    await expect(form.getByText(/Ça ressemble à un lieu privé/)).toBeVisible();
    await form.getByLabel("Jour").fill(tomorrow);
    await form.getByLabel("Heure").fill("20:30");
    expect(await axeViolations(badPage)).toEqual([]);
    await form.getByRole("button", { name: "Proposer" }).click();
    await expect(
      badPage.getByRole("region", { name: "TA CAVALE · EN ATTENTE DE RÉPONSE" }),
    ).toBeVisible();
    await expect(badPage.getByRole("button", { name: /^Proposer une Cavale/ })).toHaveCount(0);

    // The Visitor answers with something else: a concert.
    const visitorPage = await login(browser, visitor.email, visitor.password);
    await open(visitorPage, bad.pseudo);
    const proposed = visitorPage.getByRole("region", {
      name: `CAVALE PROPOSÉE PAR ${bad.pseudo.toUpperCase()}`,
    });
    await expect(proposed).toContainText("Chez moi, 12 rue des Lilas");
    await expect(proposed.getByText(/Ça ressemble à un lieu privé/)).toBeVisible();
    await proposed.getByRole("button", { name: "Autre chose" }).click();
    const counter = visitorPage.getByRole("dialog", { name: "Proposer autre chose" });
    await counter.getByText("Concert", { exact: true }).click();
    await counter.getByLabel("Nom du lieu").fill("Le Repaire, Nice");
    await expect(counter.getByText(/Ça ressemble à un lieu privé/)).toHaveCount(0);
    await counter.getByLabel("Jour").fill(tomorrow);
    await counter.getByLabel("Heure").fill("21:00");
    await counter.getByRole("button", { name: "Proposer" }).click();
    await expect(
      visitorPage.getByRole("region", { name: "TA CAVALE · EN ATTENTE DE RÉPONSE" }),
    ).toContainText("Le Repaire, Nice");
    // A Cavale waiting for an answer never folds (9l-ter), even on later openings.
    for (const page of [visitorPage, badPage]) {
      for (let opening = 0; opening < 2; opening += 1) {
        await page.reload();
        await expect(page.getByTestId("cavale-folded")).toHaveCount(0);
      }
    }
    await expect(
      visitorPage.getByRole("region", { name: "TA CAVALE · EN ATTENTE DE RÉPONSE" }),
    ).toBeVisible();

    // The Bad accepts: the card is pinned, with the safety reminder; contacts pass from now on.
    await badPage.reload();
    const other = badPage.getByRole("region", {
      name: `AUTRE PROPOSITION DE ${visitor.pseudo.toUpperCase()}`,
    });
    await other.getByRole("button", { name: "Accepter" }).click();
    const card = badPage.getByRole("region", { name: "CAVALE ACCEPTÉE" });
    await expect(card).toContainText("Concert · Le Repaire, Nice");
    await expect(card.getByRole("link", { name: "Conseils sécurité" })).toBeVisible();
    await expect(badPage.getByText("Ne partage jamais d'argent ni de codes.")).toBeVisible();
    await badPage.getByPlaceholder("Ton message").fill("Mon numéro : 06 12 34 56 78");
    await badPage.getByRole("button", { name: "Envoyer" }).click();
    await expect(badPage.getByText("Mon numéro : 06 12 34 56 78")).toBeVisible();
    expect(await axeViolations(badPage)).toEqual([]);
    // The accepted Cavale folds into one line from the next opening (9l-ter), and unfolds with
    // all its actions; folded again with its own button.
    await badPage.reload();
    const line = badPage.getByTestId("cavale-folded").getByRole("button");
    await expect(line).toHaveText(
      /^Cavale · [a-zéû]+ \d{1,2} [a-zéû]+ · 21:00 · Le Repaire, Nice$/,
    );
    await expect(line).toHaveAttribute("aria-expanded", "false");
    expect((await line.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(badPage.getByRole("button", { name: "Annuler la Cavale" })).toHaveCount(0);
    expect(await axeViolations(badPage)).toEqual([]);
    await line.click();
    const unfolded = badPage.getByRole("region", { name: "CAVALE ACCEPTÉE" });
    await expect(unfolded).toContainText("Concert · Le Repaire, Nice");
    await expect(unfolded.getByRole("button", { name: "Annuler la Cavale" })).toBeVisible();
    await expect(unfolded.getByRole("link", { name: "Conseils sécurité" })).toBeVisible();
    const fold = unfolded.getByRole("button", { name: "Replier la Cavale" });
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    expect((await fold.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await axeViolations(badPage)).toEqual([]);
    await fold.click();
    await expect(badPage.getByTestId("cavale-folded")).toBeVisible();
    await expect(badPage.getByTestId("cavale-folded")).toHaveAttribute("data-past", "false");
    // Once its time has passed, the line stays without emphasis until the end of that day (an
    // accepted Cavale leaves get_dates the next day): moved to a few seconds ago, then put back.
    const accepted = `(select d.id from public.date_proposals d join public.conversations c on c.id = d.conversation_id
       where c.visitor_id = '${visitor.id}' and d.status = 'accepted')`;
    const startsAt = asOwner(`select starts_at from public.date_proposals where id = ${accepted}`);
    asOwner(
      `update public.date_proposals set starts_at = now() - interval '5 seconds' where id = ${accepted}`,
    );
    await badPage.reload();
    await expect(badPage.getByTestId("cavale-folded")).toHaveAttribute("data-past", "true");
    asOwner(`update public.date_proposals set starts_at = '${startsAt}' where id = ${accepted}`);
    await badPage.context().close();

    await visitorPage.reload();
    await expect(visitorPage.getByRole("region", { name: "CAVALE ACCEPTÉE" })).toBeVisible();
    await expect(visitorPage.getByText("Mon numéro : 06 12 34 56 78")).toBeVisible();
    // The number sent during the visit stays masked (only messages after the lifting are in clear).
    await expect(visitorPage.getByText("Ta meilleure balade de nuit ? Mon [•••]")).toBeVisible();
    await visitorPage.context().close();
  });

  // Phase 8b, on demand (E2E_LIGHTHOUSE=true, one device): Lighthouse mobile on the member pages,
  // with the real data of the journey (SPEC §18: ≥ 90 in Performance, Accessibility, Best practices).
  test("9 bis. Lighthouse on the Promenade, Découverte, Fiche, Courrier and Parloir", async ({
    browser,
  }, testInfo) => {
    test.skip(process.env.E2E_LIGHTHOUSE !== "true", "Lighthouse on demand (E2E_LIGHTHOUSE=true)");
    test.setTimeout(300_000);
    const base = testInfo.project.use.baseURL ?? "";
    const visitorPage = await login(browser, visitor.email, visitor.password);
    await visitorPage.goto("/decouverte");
    const fiche = await visitorPage
      .getByRole("link", { name: new RegExp(bad.pseudo) })
      .first()
      .getAttribute("href");
    await visitorPage.goto("/visites");
    const parloir = await visitorPage
      .getByRole("link", { name: `Permis permanent avec ${bad.pseudo}` })
      .getAttribute("href");
    const visitorScores = await auditSignedIn(await visitorPage.context().cookies(), [
      { name: "promenade", url: `${base}/promenade` },
      { name: "decouverte", url: `${base}/decouverte` },
      { name: "fiche", url: `${base}${fiche}` },
      { name: "parloir", url: `${base}${parloir}` },
    ]);
    await visitorPage.context().close();
    const badPage = await login(browser, bad.email, bad.password);
    const badScores = await auditSignedIn(await badPage.context().cookies(), [
      { name: "courrier", url: `${base}/courrier` },
    ]);
    await badPage.context().close();

    const all = { ...visitorScores, ...badScores };
    console.log(
      Object.entries(all)
        .map(
          ([name, s]) =>
            `${name}: ${LIGHTHOUSE_CATEGORIES.map((c) => `${c}=${s[c]}`).join(" ")} LCP=${s.lcp} CLS=${s.cls} TBT=${s.tbt}`,
        )
        .join("\n"),
    );
    for (const [name, s] of Object.entries(all)) {
      for (const category of LIGHTHOUSE_CATEGORIES) {
        expect.soft(s[category], `${name} ${category}`).toBeGreaterThanOrEqual(90);
      }
    }
  });

  // Phase 8c: axe (WCAG 2.2 AA) on every main page, with the real data of the journey, for the
  // three kinds of account, and the keyboard: every element that takes the focus is shown above
  // the sticky tab bar (2.4.11). The public pages are swept in public-pages.spec.ts.
  test("9 ter. axe and keyboard on every member and Greffe page", async ({ browser }) => {
    test.setTimeout(300_000);
    /** Elements reached with Tab that end up under the tab bar (at most 80 steps). */
    const hiddenByTabBar = async (page: Page): Promise<string[]> => {
      const hidden: string[] = [];
      for (let step = 0; step < 80; step++) {
        await page.keyboard.press("Tab");
        // Measured once the page has settled (two frames: the browser's focus scroll, then the
        // correction of components/app/tab-bar-links.tsx).
        const state = await page.evaluate(async () => {
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const el = document.activeElement;
          const bar = document.querySelector("[data-tab-bar]");
          if (!el || el === document.body) return { done: true, hidden: null };
          if (!bar || bar.contains(el)) return { done: false, hidden: null };
          const r = el.getBoundingClientRect();
          const b = bar.getBoundingClientRect();
          const covered = r.height > 0 && r.bottom > b.top + 1;
          const name = `${el.tagName.toLowerCase()} « ${(el.textContent ?? "").trim().slice(0, 40)} »`;
          return { done: false, hidden: covered ? name : null };
        });
        if (state.done) break;
        if (state.hidden) hidden.push(state.hidden);
      }
      return hidden;
    };
    const sweep = async (page: Page, paths: string[]) => {
      const found: string[] = [];
      for (const path of paths) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(200);
        await expect(page.locator("h1"), path).toHaveCount(1);
        // A page with the anti-robot widget (CI: captcha on) is swept once the widget is there
        // and has its token, so that Tab also goes through it (its iframe), as a person would.
        if ((await page.locator("[data-captcha-widget]").count()) > 0) {
          await expect(page.locator('input[name="cf-turnstile-response"]'), path).not.toHaveValue(
            "",
            { timeout: 20_000 },
          );
        }
        found.push(
          ...(await hiddenByTabBar(page)).map((name) => `${path} focus under the tab bar: ${name}`),
        );
        // Target sizes are measured with the bar in the flow: content scrolled under a sticky bar
        // is not a small target (the focus case is checked above).
        await page.goto(path);
        await page.addStyleTag({ content: "[data-tab-bar] { position: static !important; }" });
        found.push(...(await axeViolations(page)).map((v) => `${path} ${v}`));
      }
      return found;
    };
    const visitId = asOwner(`select id from public.visits where visitor_id = '${visitor.id}'`);

    const visitorPage = await login(browser, visitor.email, visitor.password);
    await visitorPage.goto("/decouverte");
    const fiche =
      (await visitorPage
        .getByRole("link", { name: new RegExp(bad.pseudo) })
        .first()
        .getAttribute("href")) ?? "";
    await visitorPage.goto("/visites");
    const parloir =
      (await visitorPage
        .getByRole("link", { name: `Permis permanent avec ${bad.pseudo}` })
        .getAttribute("href")) ?? "";
    const violations = await sweep(visitorPage, [
      "/promenade",
      "/decouverte",
      fiche,
      "/demandes",
      "/visites",
      `/visites/${visitId}`,
      parloir,
      "/interrogatoire",
      "/ma-fiche",
      "/ma-fiche/decisions",
      "/ma-fiche/donnees",
      "/installer",
    ]);
    // The offline state (SPEC §17): a banner while the network is gone, then nothing.
    await visitorPage.goto("/visites");
    const offline = visitorPage.getByText("Tu es hors ligne", { exact: false });
    await visitorPage.context().setOffline(true);
    await expect(offline).toBeVisible();
    await visitorPage.context().setOffline(false);
    await expect(offline).toBeHidden();
    await visitorPage.context().close();

    const badPage = await login(browser, bad.email, bad.password);
    violations.push(
      ...(await sweep(badPage, [
        "/courrier",
        "/mon-casier",
        "/mon-casier/apercu",
        "/visites",
        "/ma-fiche",
      ])),
    );
    // Before hydration too (CI n° 117): with the scripts of the page held back, as on a slow
    // phone, Tab never leaves the focus under the bar (public/focus-lift.js is already there).
    const chunks = /\/_next\/static\/chunks\//;
    await badPage.route(chunks, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    for (const path of ["/mon-casier", "/ma-fiche/donnees"]) {
      await badPage.goto(path);
      await expect(badPage.locator("h1"), path).toHaveCount(1);
      violations.push(
        ...(await hiddenByTabBar(badPage)).map(
          (name) => `${path} (scripts held back) focus under the tab bar: ${name}`,
        ),
      );
    }
    await badPage.unroute(chunks);
    await badPage.context().close();

    const greffe = await (await browser.newContext()).newPage();
    await openGreffe(greffe, greffier);
    const zone = asOwner("select id from public.launch_zones where slug = 'toulon'");
    violations.push(
      ...(await sweep(greffe, [
        "/admin/greffe",
        "/admin/signalements",
        "/admin/textes",
        "/admin/membres",
        `/admin/membres/${bad.id}`,
        "/admin/historique",
        "/admin/quartiers",
        `/admin/quartiers/${zone}`,
        "/admin/signes",
        "/admin/mots-cles",
        "/admin/questions",
        "/admin/performance",
        "/admin/vue",
        "/admin/vue/promenade",
        `/admin/vue/fiche/${bad.id}`,
      ])),
    );
    await greffe.context().close();
    expect(violations).toEqual([]);
  });

  test("10. the notifications leave: mail, slot, visit, Permis permanent, a message, the Cavale", async ({
    request,
  }) => {
    const response = await request.post("/api/cron/push", {
      data: {},
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    expect(response.status()).toBe(200);
    const mine = (endpoint: string) =>
      push.received
        .filter((r) => `${push.url}${r.path}` === endpoint)
        .map((r) => JSON.parse(r.plaintext) as { t: string; u: string });
    // Besides the Greffe's own news (decision, Permis delivered), queued since step 2.
    expect(mine(endpoints.bad)).toContainEqual({ t: "request_received", u: "/courrier" });
    expect(mine(endpoints.bad)).toContainEqual({ t: "slot_chosen", u: "/visites" });
    expect(mine(endpoints.bad)).toContainEqual({ t: "visit_starting", u: "/visites" });
    expect(mine(endpoints.bad)).toContainEqual({ t: "visit_released", u: "/visites" });
    expect(mine(endpoints.visitor)).toContainEqual({ t: "visit_released", u: "/visites" });
    expect(mine(endpoints.visitor)).toContainEqual({ t: "message_received", u: "/visites" });
    expect(mine(endpoints.visitor)).toContainEqual({ t: "request_accepted", u: "/demandes" });
    expect(mine(endpoints.visitor)).toContainEqual({ t: "permit_granted", u: "/ma-fiche" });
    expect(mine(endpoints.visitor)).toContainEqual({ t: "date_proposed", u: "/visites" });
    expect(mine(endpoints.bad)).toContainEqual({ t: "date_countered", u: "/visites" });
    expect(mine(endpoints.visitor)).toContainEqual({ t: "date_accepted", u: "/visites" });
    for (const received of push.received) {
      // A type and an internal path, nothing else.
      expect(Object.keys(JSON.parse(received.plaintext)).sort()).toEqual(["t", "u"]);
      expect(received.plaintext).not.toContain(bad.pseudo);
      expect(received.plaintext).not.toContain(visitor.pseudo);
    }
  });

  test("11. Bloquer in the Parloir: nothing passes any more", async ({ browser }) => {
    const visitorPage = await login(browser, visitor.email, visitor.password);
    await visitorPage.goto("/visites");
    await visitorPage.getByRole("link", { name: `Permis permanent avec ${bad.pseudo}` }).click();
    await visitorPage.waitForURL(/\/visites\/parloir\/(?<id>[0-9a-f-]+)$/);
    const conversationUrl = visitorPage.url();
    // Signaler a message of the Bad through its « ⋯ » (9l), then Bloquer from the plate.
    const message = visitorPage
      .locator("[data-message-id]")
      .filter({ hasText: "On se refait ça quand tu veux." });
    await message.getByRole("button", { name: `Signaler ce message de ${bad.pseudo}` }).focus();
    await visitorPage.keyboard.press("Enter");
    const report = visitorPage.getByRole("dialog", {
      name: `Signaler un message de ${bad.pseudo}`,
    });
    await report.getByLabel("Arnaque").check();
    await report.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(report.getByText(/Merci. Le Greffe va regarder./)).toBeVisible();
    await report.getByRole("button", { name: "Fermer" }).last().click();
    await expect(report).toHaveCount(0);
    const { data: reported } = await admin
      .from("reports")
      .select("target_type, category")
      .eq("reporter_id", visitor.id)
      .eq("target_type", "message");
    expect(reported).toEqual([{ target_type: "message", category: "scam" }]);
    await visitorPage
      .getByRole("button", { name: `Actions du Parloir avec ${bad.pseudo}` })
      .click();
    await visitorPage.getByRole("button", { name: "Bloquer", exact: true }).click();
    await visitorPage
      .getByRole("dialog", { name: /Bloquer/ })
      .getByRole("button", { name: "Bloquer" })
      .click();
    await visitorPage.waitForURL(/\/visites$/);
    await visitorPage.context().close();

    const { data } = await admin
      .from("date_proposals")
      .select("status")
      .eq("proposer_id", visitor.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(data?.status).toBe("cancelled");
    const badPage = await login(browser, bad.email, bad.password);
    const response = await badPage.goto(conversationUrl);
    expect(response?.status()).toBe(404);
    await badPage.context().close();
  });

  test("12. the Visitor deletes their account, for real", async ({ browser }) => {
    const page = await login(browser, visitor.email, visitor.password);
    await page.goto("/ma-fiche/donnees");
    await page.getByLabel("Ton mot de passe").fill(visitor.password);
    await page.getByLabel("Je comprends que la suppression est définitive.").check();
    await page.getByRole("button", { name: "Supprimer définitivement mon compte" }).click();
    await page.waitForURL(/compte=supprime/);
    await page.context().close();
    const { data } = await admin.auth.admin.getUserById(visitor.id);
    expect(data.user).toBeNull();
    expect(asOwner(`select count(*) from public.profiles where id = '${visitor.id}'`)).toBe("0");
    expect(asOwner(`select count(*) from public.photos where owner_id = '${visitor.id}'`)).toBe(
      "0",
    );
    // The Bad's side keeps working without the Visitor.
    const badPage = await login(browser, bad.email, bad.password);
    for (const path of ["/visites", "/courrier"]) {
      expect((await badPage.goto(path))?.status(), path).toBe(200);
    }
    await badPage.context().close();
  });
});
