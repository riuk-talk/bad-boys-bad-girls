import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { openGreffe } from "./helpers/admin";

// Phase 7 end to end, LOCAL STACK ONLY: a Visitor reports a Bad, the Greffe (an admin, second
// factor) upholds it with a warning and two motives, each one reads their exposé des motifs; the
// Bad exports their data; the Visitor deletes their account; the Bad is banned and the same
// e-mail cannot sign up again (real Auth service, hook « Before User Created »). Throwaway
// accounts in a throwaway open zone in the Atlantic, everything deleted afterwards.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const dbUrl = process.env.SUPABASE_DB_URL ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  /@(127\.0\.0\.1|localhost):/.test(dbUrl) &&
  secret !== "" &&
  publishable !== "";

const REPORTER_MOTIVE = "Merci : ton signalement est retenu par le Greffe.";
const TARGET_MOTIVE = "Propos déplacés dans ta note comportementale : premier avertissement.";
const BAN_MOTIVE = "Arnaque avérée envers plusieurs membres, après vérification.";

/** SQL as the database owner (what the owner does by hand in the SQL editor). */
function asOwner(sql: string) {
  execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], { stdio: "pipe" });
}

async function login(browser: Browser, email: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/connexion");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((target) => !/^\/(connexion|onboarding)$/.test(target.pathname));
  return page;
}

test.describe("Phase 7: moderation and RGPD (local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const accounts: string[] = [];
  const publicFiles: string[] = [];
  let placeId = 0;
  let zoneId = 0;
  type Account = { email: string; password: string; id: string; pseudo: string };
  const bad: Account = {
    email: "",
    password: "",
    id: "",
    pseudo: `Rix${randomBytes(2).toString("hex")}`,
  };
  const visitor: Account = {
    email: "",
    password: "",
    id: "",
    pseudo: `Vex${randomBytes(2).toString("hex")}`,
  };
  const greffier = { email: "", password: "", id: "", totpSecret: "" };

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

  async function approvedPhoto(owner: string, position: number) {
    const name = randomUUID();
    const large = await sharp({
      create: { width: 960, height: 1200, channels: 3, background: "#7a2a3a" },
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

  async function member(target: Account, role: "bad" | "visitor", gender: "woman" | "man") {
    Object.assign(target, await account());
    const { error } = await admin.from("profiles").insert({
      id: target.id,
      pseudo: target.pseudo,
      birthdate: role === "bad" ? "1994-04-04" : "1991-09-09",
      gender,
      seeking_genders: [gender === "woman" ? "man" : "woman"],
      seek_age_min: 25,
      seek_age_max: 45,
      place_id: placeId,
      role,
      visit_motive:
        role === "visitor" ? "Couche-tard, motard, curieux des gens francs du collier." : null,
      bio: role === "bad" ? "Tatouée de la tête aux pieds, franche du collier." : null,
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
    for (const position of role === "bad" ? [0, 1, 2] : [0])
      await approvedPhoto(target.id, position);
  }

  test.beforeAll(async () => {
    const { data: place, error: placeError } = await admin
      .from("places")
      .insert({
        official_code: `E2E${randomBytes(3).toString("hex")}`,
        name: "Port-Greffe",
        lat: 46.4,
        lng: -8.6,
      })
      .select("id")
      .single();
    if (placeError) throw placeError;
    placeId = place.id;
    const { data: zone, error: zoneError } = await admin
      .from("launch_zones")
      .insert({
        slug: `e2e-${randomBytes(3).toString("hex")}`,
        name: "Port-Greffe",
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
      charge_1: "A traversé la Loire à la nage.",
      charge_2: "A dormi dans un phare.",
      charge_3: "A volé une cloche de vache.",
      true_index: 1,
    });
    if (error) throw error;
    Object.assign(greffier, await account());
    asOwner(`insert into public.admin_users (user_id, note) values ('${greffier.id}', 'e2e')`);
  });

  test.afterAll(async () => {
    if (publicFiles.length) await admin.storage.from("photos").remove(publicFiles);
    for (const userId of accounts) await admin.auth.admin.deleteUser(userId);
    if (zoneId) await admin.from("launch_zones").delete().eq("id", zoneId);
    if (placeId) await admin.from("places").delete().eq("id", placeId);
  });

  test("a report, a reasoned decision, an exposé des motifs for each side", async ({ browser }) => {
    const reporter = await login(browser, visitor.email, visitor.password);
    await reporter.goto(`/fiche/${bad.id}`);
    await reporter.getByRole("button", { name: "Signaler" }).click();
    await reporter.getByLabel("Harcèlement").check();
    await reporter.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(reporter.getByText("Merci. Le Greffe va regarder.")).toBeVisible();

    const greffe = await (await browser.newContext()).newPage();
    greffier.totpSecret = await openGreffe(greffe, greffier);
    await greffe.goto("/admin/signalements");
    const card = greffe.getByRole("listitem").filter({ hasText: bad.pseudo });
    await expect(card).toBeVisible();
    await card.getByLabel("Retenir").check();
    await card.getByLabel("Motif pour le signaleur").fill(REPORTER_MOTIVE);
    await card.getByLabel("Sanction (si retenu)").selectOption("warn");
    await card.getByLabel("Motif pour la personne concernée (si retenu)").fill(TARGET_MOTIVE);
    await card.getByRole("button", { name: "Enregistrer la décision" }).click();
    await expect(greffe.getByText("Décision enregistrée.")).toBeVisible();

    await reporter.goto("/ma-fiche/decisions");
    await expect(reporter.getByText(REPORTER_MOTIVE)).toBeVisible();
    await expect(reporter.getByText("Retenu par le Greffe.", { exact: true })).toBeVisible();
    await expect(reporter.getByText(TARGET_MOTIVE)).toHaveCount(0);

    const target = await login(browser, bad.email, bad.password);
    await target.goto("/ma-fiche/decisions");
    await expect(target.getByText(TARGET_MOTIVE)).toBeVisible();
    await expect(target.getByText("Avertissement du Greffe")).toBeVisible();
    await expect(target.getByText(visitor.pseudo)).toHaveCount(0);
  });

  test("the export holds my data and nothing of the other person", async ({ browser }) => {
    const page = await login(browser, bad.email, bad.password);
    const response = await page.request.get("/api/me/export");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toContain("attachment");
    const body = await response.text();
    const data = JSON.parse(body) as {
      profile: { pseudo: string };
      decisions_about_me: { reason: string }[];
    };
    expect(data.profile.pseudo).toBe(bad.pseudo);
    expect(data.decisions_about_me[0]?.reason).toBe(TARGET_MOTIVE);
    expect(body).not.toContain(visitor.id);
    expect(body).not.toContain(REPORTER_MOTIVE);
  });

  test("the Visitor deletes their account, for real", async ({ browser }) => {
    const page = await login(browser, visitor.email, visitor.password);
    await page.goto("/ma-fiche/donnees");
    await page.getByLabel("Ton mot de passe").fill("not-the-password");
    await page.getByLabel("Je comprends que la suppression est définitive.").check();
    await page.getByRole("button", { name: "Supprimer définitivement mon compte" }).click();
    await expect(page.getByText("Mot de passe incorrect.")).toBeVisible();
    // After an error the form is reset: the confirmation is asked again.
    await page.getByLabel("Ton mot de passe").fill(visitor.password);
    await page.getByLabel("Je comprends que la suppression est définitive.").check();
    await page.getByRole("button", { name: "Supprimer définitivement mon compte" }).click();
    await page.waitForURL(/compte=supprime/);
    const { data } = await admin.auth.admin.getUserById(visitor.id);
    expect(data.user).toBeNull();
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("id", visitor.id)
      .maybeSingle();
    expect(profile).toBeNull();
    const { data: photos } = await admin.from("photos").select("id").eq("owner_id", visitor.id);
    expect(photos ?? []).toEqual([]);
  });

  test("a banned member cannot sign up again with the same e-mail", async ({ browser }) => {
    const greffe = await (await browser.newContext()).newPage();
    await openGreffe(greffe, greffier);
    await greffe.goto(`/admin/membres/${bad.id}`);
    await greffe.getByLabel("Décision", { exact: true }).selectOption("ban");
    await greffe.getByLabel("Motif pour le membre").fill(BAN_MOTIVE);
    await greffe.getByRole("button", { name: "Appliquer" }).click();
    await expect(greffe.getByText("Décision enregistrée.")).toBeVisible();

    // The account is gone (as a deletion by the owner would do): only the fingerprint remains.
    expect((await admin.auth.admin.deleteUser(bad.id)).error).toBeNull();
    const anon = createClient(url, publishable, { auth: { persistSession: false } });
    const again = await anon.auth.signUp({
      email: bad.email,
      password: `Pw-${randomBytes(12).toString("base64url")}`,
    });
    expect(again.error, "the same e-mail is refused").not.toBeNull();
    const other = await anon.auth.signUp({
      email: `e2e-${randomBytes(4).toString("hex")}@example.com`,
      password: `Pw-${randomBytes(12).toString("base64url")}`,
    });
    expect(other.error, "another e-mail signs up").toBeNull();
    if (other.data.user) accounts.push(other.data.user.id);
  });
});
