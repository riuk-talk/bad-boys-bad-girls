import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { openAdmin } from "./helpers/admin";
import { cutoutReady } from "./helpers/onboarding";
import { settled } from "./helpers/settle";

// The full member record (10i), LOCAL STACK ONLY: the sections in their order, the exact date of
// birth, the N° d'écrou, the Interrogatoire, the activity, the settings; the e-mail only after
// « Afficher l'e-mail » for a role holding members.email, each showing logged; the gender as the
// person's (« Femme », not the criteria's « femmes »); every hour in the clock of France, never
// UTC (the admin's record, and a member's page).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const dbUrl = process.env.SUPABASE_DB_URL ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  /@(127\.0\.0\.1|localhost):/.test(dbUrl) &&
  secret !== "";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
/** 06:20 UTC on 15 January: 07:20 in Paris (winter), the hour that must show. */
const AT_UTC = "2026-01-15T06:20:00Z";

async function axeViolations(page: Page) {
  await settled(page);
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}

function asOwner(sql: string): string {
  return execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

test.describe("full member record (10i, local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const accounts: string[] = [];
  const chief = { email: "", password: "", id: "", totpSecret: "" };
  const moderator = { email: "", password: "", id: "", totpSecret: "" };
  const rose = { email: "", password: "", id: "", pseudo: `Rose${randomBytes(2).toString("hex")}` };
  const nox = { email: "", password: "", id: "", pseudo: `Nox${randomBytes(2).toString("hex")}` };
  let placeId = 0;

  async function account(target: { email: string; password: string; id: string }) {
    target.email = `e2e-record-${randomBytes(4).toString("hex")}@example.com`;
    target.password = `Pw-${randomBytes(12).toString("base64url")}`;
    const { data, error } = await admin.auth.admin.createUser({
      email: target.email,
      password: target.password,
      email_confirm: true,
    });
    if (error) throw error;
    target.id = data.user.id;
    accounts.push(data.user.id);
  }

  async function profile(target: { id: string; pseudo: string }, role: "bad" | "visitor") {
    const { error } = await admin.from("profiles").insert({
      id: target.id,
      pseudo: target.pseudo,
      birthdate: "1994-07-09",
      gender: role === "bad" ? "woman" : "man",
      seeking_genders: [role === "bad" ? "man" : "woman"],
      place_id: placeId,
      role,
      visit_motive:
        role === "visitor" ? "Je viens pour une vraie conversation, sans détour." : null,
    });
    if (error) throw error;
    const { error: done } = await admin
      .from("profiles")
      .update({ onboarding_completed_at: new Date().toISOString(), onboarding_step: 8 })
      .eq("id", target.id);
    if (done) throw done;
  }

  test.beforeAll(async () => {
    const { data: place, error } = await admin
      .from("places")
      .insert({
        official_code: `E2E${randomBytes(3).toString("hex")}`,
        name: "Port-Fiche",
        lat: 46.6,
        lng: -8.3,
      })
      .select("id")
      .single();
    if (error) throw error;
    placeId = place.id;
    await account(chief);
    await account(moderator);
    asOwner(
      `insert into public.admin_users (user_id, role_id) values ('${chief.id}', 1), ('${moderator.id}', 2)`,
    );
    await account(rose);
    await account(nox);
    await profile(rose, "bad");
    await profile(nox, "visitor");
    // The account created at 06:20 UTC (07:20 in Paris).
    asOwner(`update auth.users set created_at = '${AT_UTC}' where id = '${rose.id}'`);
    asOwner(
      `insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index)
       values ('${rose.id}', 'Vol de lune', 'Excès de charme', 'Retard chronique', 2)`,
    );
    asOwner(
      `insert into public.answers (user_id, question_id, option_id, accepted_option_ids, importance)
       select '${rose.id}', q.id, (select min(o.id) from public.question_options o where o.question_id = q.id),
         array(select o.id from public.question_options o where o.question_id = q.id order by o.position limit 2), 'essential'
       from public.questions q order by q.position limit 1`,
    );
    asOwner(
      `insert into public.visit_requests (visitor_id, bad_id, guessed_index, casier_snapshot, guess_correct)
       values ('${nox.id}', '${rose.id}', 1, '{}', false)`,
    );
    asOwner(
      `update public.profiles set is_paused = true, paused_at = now() where id = '${rose.id}'`,
    );
    // A message of the Greffe written at 06:20 UTC, for the member's page.
    asOwner(
      `with t as (insert into public.greffe_threads (member_id, opened_by) values ('${rose.id}', '${chief.id}') returning id)
       insert into public.greffe_messages (thread_id, author_id, side, author_label, body, created_at)
       select t.id, '${chief.id}', 'team', 'Le Greffe', 'Un mot du Greffe à l''heure de Paris.', '${AT_UTC}' from t`,
    );
  });

  test.afterAll(() => {
    asOwner(
      `delete from public.admin_users where user_id = any (array[${accounts.map((id) => `'${id}'`).join(",")}]::uuid[])`,
    );
    for (const id of accounts) asOwner(`delete from auth.users where id = '${id}'`);
    if (placeId) asOwner(`delete from public.places where id = ${placeId}`);
  });

  async function staffPage(browser: Browser, who: typeof chief) {
    const page = await (await browser.newContext()).newPage();
    who.totpSecret = await openAdmin(page, who);
    return page;
  }

  test("the Admin: the whole record, in order, Paris time, the e-mail on request (logged)", async ({
    browser,
  }) => {
    const page = await staffPage(browser, chief);
    await page.goto(`/admin/membres/${rose.id}`);
    await expect(page.getByRole("heading", { name: rose.pseudo, level: 1 })).toBeVisible();
    const sections = await page.locator("details[data-section] summary h2").allInnerTexts();
    expect(sections.map((title) => title.toUpperCase())).toEqual(
      [
        "Identité",
        "Recherche",
        "Fiche",
        "Interrogatoire",
        "Photos",
        "Activité",
        "Réglages",
        "Consentements",
        "Historique",
      ].map((title) => title.toUpperCase()),
    );
    const identity = page.locator('details[data-section="identity"]');
    // The person's gender, not the criteria's plural.
    await expect(identity.getByText("Femme", { exact: true })).toBeVisible();
    await expect(identity.getByText(/9 juillet 1994/)).toBeVisible();
    const ecrou = asOwner(`select ecrou from public.profiles where id = '${rose.id}'`);
    await expect(identity.getByText(ecrou, { exact: true })).toBeVisible();
    // 06:20 UTC is shown 07:20 (Paris), never 06:20.
    await expect(identity.getByText(/15 janv\. 2026.*07:20/)).toBeVisible();
    await expect(page.getByText(/06:20/)).toHaveCount(0);
    // The Casier: the 3 charges, nothing marked.
    const fiche = page.locator('details[data-section="fiche"]');
    await expect(fiche.getByRole("listitem")).toHaveText([
      "Vol de lune",
      "Excès de charme",
      "Retard chronique",
    ]);
    expect(await page.content()).not.toContain("true_index");
    await expect(
      page.locator('details[data-section="interrogation"]').getByText("Essentiel"),
    ).toBeVisible();
    const activity = page.locator('details[data-section="activity"]');
    await expect(activity.getByText("en attente : 1")).toBeVisible();
    await expect(activity.getByRole("link", { name: nox.pseudo })).toBeVisible();
    await expect(
      page.locator('details[data-section="settings"]').getByText(/En pause depuis le/),
    ).toBeVisible();
    // The e-mail: not in the page before the click.
    expect(await page.content()).not.toContain(rose.email);
    expect(await axeViolations(page)).toEqual([]);
    await identity.getByRole("button", { name: "Afficher l'e-mail" }).click();
    await expect(page.getByTestId("member-email")).toHaveText(rose.email);
    expect(
      asOwner(
        `select count(*) from public.greffe_fiche_views where admin_id = '${chief.id}' and bad_id = '${rose.id}' and context = 'email'`,
      ),
    ).toBe("1");
    // Folding: a section closes and opens.
    await page.locator('details[data-section="activity"] summary').click();
    await expect(activity.getByText(/en attente : 1/)).toBeHidden();
    await page.context().close();
  });

  test("the Modérateur: the record, never the e-mail", async ({ browser }) => {
    const page = await staffPage(browser, moderator);
    await page.goto(`/admin/membres/${rose.id}`);
    const identity = page.locator('details[data-section="identity"]');
    await expect(identity.getByText(/Masqué/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Afficher l'e-mail" })).toHaveCount(0);
    expect(await page.content()).not.toContain(rose.email);
    await page.context().close();
  });

  test("a member's page: the hours in Paris time too", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto("/connexion");
    await page.getByLabel("E-mail").fill(rose.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(rose.password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL((target) => !/^\/(connexion|onboarding)$/.test(target.pathname));
    await expect(page.locator("main h1").first()).toBeVisible();
    if ((await page.locator("[data-cutout-engine]").count()) > 0) await cutoutReady(page);
    await page.goto("/ma-fiche/courrier-du-greffe");
    const thread = page.getByRole("list", { name: "Messages du fil" });
    await expect(thread.getByText("Un mot du Greffe à l'heure de Paris.")).toBeVisible();
    await expect(thread.getByText("07:20", { exact: true })).toBeVisible();
    await expect(thread.getByText("06:20", { exact: true })).toHaveCount(0);
    await page.context().close();
  });
});
