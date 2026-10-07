import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { openGreffe } from "./helpers/admin";
import { FakePushService } from "./helpers/fake-push-service";

// THE end-to-end journey, LOCAL STACK ONLY (scripts/ci/local-env.mjs). Owner's rule (2026-10-07):
// every later phase extends it (visit, Parloir, Permis permanent, Cavale) before it is done.
//   1. A Bad and a Visitor in Toulon, photos waiting at the Greffe (as after a real upload).
//   2. A test admin opens /admin/greffe with the second factor and validates the 4 photos
//      (copy to the public storage included).
//   3. Toulon is opened (local database only); the Bad is visible to the Visitor (can_view_bad),
//      who finds the Fiche in the Découverte and files a Demande de parloir.
//   4. The Bad accepts it in the Courrier.
//   5. Both notifications leave through /api/cron/push to a fake push service.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const dbUrl = process.env.SUPABASE_DB_URL ?? "";
const cronSecret = process.env.PUSH_CRON_SECRET ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  /@(127\.0\.0\.1|localhost):/.test(dbUrl) &&
  [publishable, secret, cronSecret].every((value) => value !== "") &&
  Boolean(process.env.PUSH_TEST_TLS_CERT);

const CHARGES = [
  "A traversé la Corse à vélo sans jamais regarder une carte.",
  "A été figurante dans un clip de rap marseillais.",
  "Collectionne les cartes postales de phares.",
];

/** SQL as the database owner, local stack only; returns the single value printed. */
function asOwner(sql: string): string {
  return execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

async function login(browser: Browser, email: string, password: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/connexion");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((target) => !/^\/(connexion|onboarding)$/.test(target.pathname));
  return page;
}

test.describe("journey: Greffe → Découverte → Demande → Courrier → notifications (local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const push = new FakePushService();
  const tag = randomBytes(2).toString("hex");
  type Member = { email: string; password: string; id: string; pseudo: string };
  const bad: Member = { email: "", password: "", id: "", pseudo: `Lune${tag}` };
  const visitor: Member = { email: "", password: "", id: "", pseudo: `Nox${tag}` };
  const greffier = { email: "", password: "", id: "" };
  const endpoints = { bad: "", visitor: "" };
  const files: { pending: string[]; published: string[] } = { pending: [], published: [] };

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

  /** A photo as the onboarding leaves it: two WebP files in photos-pending, a pending row. */
  async function pendingPhoto(owner: string, position: number, color: string) {
    const base = `${owner}/${randomUUID()}`;
    const large = await sharp({
      create: { width: 960, height: 1200, channels: 3, background: color },
    })
      .webp()
      .toBuffer();
    const small = await sharp(large).resize(320, 400).webp().toBuffer();
    for (const [path, body] of [
      [`${base}.webp`, large],
      [`${base}-s.webp`, small],
    ] as const) {
      const { error } = await admin.storage
        .from("photos-pending")
        .upload(path, body, { contentType: "image/webp" });
      if (error) throw error;
      files.pending.push(path);
    }
    const { error } = await admin.from("photos").insert({
      owner_id: owner,
      position,
      pending_path: `${base}.webp`,
      width: 960,
      height: 1200,
    });
    if (error) throw error;
  }

  async function member(target: Member, role: "bad" | "visitor", gender: "woman" | "man") {
    Object.assign(target, await account());
    const toulon = asOwner("select id from public.places where official_code = '83137'");
    const { error } = await admin.from("profiles").insert({
      id: target.id,
      pseudo: target.pseudo,
      birthdate: role === "bad" ? "1995-05-12" : "1991-09-30",
      gender,
      seeking_genders: [gender === "woman" ? "man" : "woman"],
      seek_age_min: 25,
      seek_age_max: 45,
      place_id: Number(toulon),
      role,
      visit_motive:
        role === "visitor" ? "Motard du dimanche, je préfère les phares aux bars bondés." : null,
      bio: role === "bad" ? "Tatouée, franche du collier, allergique aux plans trop sages." : null,
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
    for (const position of role === "bad" ? [0, 1, 2] : [0]) {
      await pendingPhoto(target.id, position, gender === "woman" ? "#7a2a3a" : "#2a4a7a");
    }
  }

  /** The member's browser subscribes to the fake push service (same function as the app). */
  async function subscribe(target: Member): Promise<string> {
    const client = createClient(url, publishable, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({
      email: target.email,
      password: target.password,
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
    await member(bad, "bad", "woman");
    await member(visitor, "visitor", "man");
    const { error } = await admin.from("casier_charges").insert({
      profile_id: bad.id,
      charge_1: CHARGES[0],
      charge_2: CHARGES[1],
      charge_3: CHARGES[2],
      true_index: 1,
    });
    if (error) throw error;
    Object.assign(greffier, await account());
    asOwner(
      `insert into public.admin_users (user_id, note) values ('${greffier.id}', 'e2e journey')`,
    );
    endpoints.bad = await subscribe(bad);
    endpoints.visitor = await subscribe(visitor);
  });

  test.afterAll(async () => {
    asOwner("update public.launch_zones set status = 'waitlist' where slug = 'toulon'");
    if (files.published.length) await admin.storage.from("photos").remove(files.published);
    if (files.pending.length) await admin.storage.from("photos-pending").remove(files.pending);
    for (const id of [bad.id, visitor.id, greffier.id])
      if (id) await admin.auth.admin.deleteUser(id);
    await push.stop();
  });

  test("2. the Greffe validates the 4 photos (second factor, copy to the public storage)", async ({
    browser,
  }) => {
    const page = await (await browser.newContext()).newPage();
    await openGreffe(page, greffier);
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
      await card(pseudo, pose).getByRole("button", { name: "Valider" }).click();
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
    await expect(page.getByText("1 VRAI · 2 FAUX")).toBeVisible();
    await page.getByRole("button", { name: "Demander une visite" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText(CHARGES[0]!).click();
    await dialog.getByRole("button", { name: /^« / }).first().click();
    await dialog.getByRole("button", { name: "Déposer ma demande" }).click();
    await expect(dialog.getByRole("heading", { name: "Demande déposée au Parloir" })).toBeVisible();
    await page.context().close();
  });

  test("4. the Bad accepts it in the Courrier", async ({ browser }) => {
    const page = await login(browser, bad.email, bad.password);
    await page.goto("/courrier");
    await page.getByRole("link", { name: new RegExp(visitor.pseudo) }).click();
    await page.getByRole("button", { name: "Accepter la visite" }).click();
    await expect(page.getByRole("img", { name: /visite acceptée/i })).toBeVisible();
    await page.context().close();
    const { data } = await admin
      .from("visit_requests")
      .select("status")
      .eq("bad_id", bad.id)
      .eq("visitor_id", visitor.id)
      .single();
    expect(data?.status).toBe("accepted");
  });

  test("5. both notifications leave: the Bad's mail, the Visitor's good news", async ({
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
    expect(mine(endpoints.visitor)).toContainEqual({ t: "request_accepted", u: "/demandes" });
    expect(mine(endpoints.visitor)).toContainEqual({ t: "permit_granted", u: "/ma-fiche" });
    for (const received of push.received) {
      // A type and an internal path, nothing else.
      expect(Object.keys(JSON.parse(received.plaintext)).sort()).toEqual(["t", "u"]);
      expect(received.plaintext).not.toContain(bad.pseudo);
      expect(received.plaintext).not.toContain(visitor.pseudo);
    }
  });
});
