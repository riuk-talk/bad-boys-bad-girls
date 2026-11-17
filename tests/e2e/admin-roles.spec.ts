import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { openAdmin } from "./helpers/admin";
import { settled } from "./helpers/settle";

// Administration roles (10f), LOCAL STACK ONLY. The super admin gives the starting roles and a
// role of its own on the Équipe page; each role sees only its pages (the menu, 403 elsewhere); a
// member account given a role (Coco, a Visitor who only looks at profiles) leaves the site as a
// member and comes back as it was; every change is in the Historique.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const dbUrl = process.env.SUPABASE_DB_URL ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  /@(127\.0\.0\.1|localhost):/.test(dbUrl) &&
  secret !== "";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function axeViolations(page: Page) {
  await settled(page);
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}

/** SQL as the database owner; returns what it prints. */
function asOwner(sql: string): string {
  return execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

type Account = { email: string; password: string; id: string; totpSecret: string };

/** The entries of the admin menu, as the role sees them (the drawer on a phone). */
async function menuEntries(page: Page): Promise<string[]> {
  const button = page.getByRole("button", { name: "Menu admin" });
  if (await button.isVisible()) {
    await button.click();
    const drawer = page.getByRole("dialog", { name: "Menu admin" });
    const names = await drawer.getByRole("link").allInnerTexts();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    return names.map((name) => name.split("\n")[0]!.trim());
  }
  const names = await page
    .getByRole("navigation", { name: "Administration" })
    .getByRole("link")
    .allInnerTexts();
  return names.map((name) => name.split("\n")[0]!.trim());
}

async function expectForbidden(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `${path} answers 403`).toBe(403);
  await expect(page.getByRole("heading", { name: "Accès refusé", level: 1 })).toBeVisible();
}

test.describe("administration roles (10f, local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const accounts: string[] = [];
  const boss: Account = { email: "", password: "", id: "", totpSecret: "" };
  const coco: Account & { pseudo: string } = {
    email: "",
    password: "",
    id: "",
    totpSecret: "",
    pseudo: `Coco${randomBytes(2).toString("hex")}`,
  };
  const bad = { id: "" };
  const moderator: Account = { email: "", password: "", id: "", totpSecret: "" };
  const full: Account = { email: "", password: "", id: "", totpSecret: "" };
  const custom: Account = { email: "", password: "", id: "", totpSecret: "" };
  const customRole = `Greffe seul ${randomBytes(2).toString("hex")}`;
  let requestId = "";

  async function account(target: { email: string; password: string; id: string }) {
    target.email = `e2e-roles-${randomBytes(4).toString("hex")}@example.com`;
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

  async function profile(id: string, pseudo: string, role: "bad" | "visitor") {
    const { error } = await admin.from("profiles").insert({
      id,
      pseudo,
      birthdate: "1991-03-03",
      gender: role === "bad" ? "woman" : "man",
      seeking_genders: [role === "bad" ? "man" : "woman"],
      role,
      visit_motive: role === "visitor" ? "Je regarde les profils pour le site." : null,
    });
    if (error) throw error;
    await admin
      .from("profiles")
      .update({ onboarding_completed_at: new Date().toISOString(), onboarding_step: 8 })
      .eq("id", id);
  }

  test.beforeAll(async () => {
    for (const target of [boss, coco, moderator, full, custom]) await account(target);
    asOwner(`insert into public.super_admins (user_id, note) values ('${boss.id}', 'e2e 10f')`);
    // Coco: a Visitor with a request waiting at a Bad.
    await profile(coco.id, coco.pseudo, "visitor");
    const badAccount = { email: "", password: "", id: "" };
    await account(badAccount);
    bad.id = badAccount.id;
    await profile(bad.id, `Rose${randomBytes(2).toString("hex")}`, "bad");
    requestId = asOwner(
      `insert into public.visit_requests (visitor_id, bad_id, guessed_index, casier_snapshot, guess_correct)
       values ('${coco.id}', '${bad.id}', 1, '{}', false) returning id`,
    ).split("\n")[0]!;
  });

  test.afterAll(() => {
    if (boss.id) asOwner(`delete from public.super_admins where user_id = '${boss.id}'`);
    asOwner(
      `delete from public.admin_users where user_id = any (array[${accounts.map((id) => `'${id}'`).join(",")}]::uuid[])`,
    );
    asOwner(`delete from public.admin_roles where name = '${customRole}'`);
    for (const id of accounts) asOwner(`delete from auth.users where id = '${id}'`);
  });

  async function signedIn(browser: Browser, who: Account) {
    const page = await (await browser.newContext()).newPage();
    who.totpSecret = await openAdmin(page, who);
    return page;
  }

  test("Équipe: the super admin gives the starting roles and creates one of its own", async ({
    browser,
  }) => {
    const page = await signedIn(browser, boss);
    expect(await menuEntries(page)).toContain("Équipe");
    await page.goto("/admin/equipe");
    await expect(page.getByRole("heading", { name: "Équipe", level: 1 })).toBeVisible();
    await expect(page.getByText("Super admin (intouchable)")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    const grant = page.getByRole("region", { name: "Donner un rôle" });
    const roleOf = (id: string) =>
      asOwner(
        `select coalesce((select r.name from public.admin_users a join public.admin_roles r on r.id = a.role_id where a.user_id = '${id}'), 'none')`,
      );
    for (const [who, id, role] of [
      [coco.pseudo, coco.id, "Observateur"],
      [moderator.email, moderator.id, "Modérateur"],
      [full.email.toUpperCase(), full.id, "Admin"],
    ] as const) {
      await grant.getByLabel("E-mail exact ou pseudo").fill(who);
      await grant.getByLabel("Rôle").selectOption({ label: role });
      await grant.getByRole("button", { name: "Donner le rôle" }).click();
      await expect.poll(() => roleOf(id), { message: `${role} given` }).toBe(role);
      // The decision recorded: the page again, from a clean load.
      await page.goto("/admin/equipe");
    }

    // A role of its own: the Greffe only.
    const fresh = page.getByRole("form", { name: "Nouveau rôle" });
    await fresh.getByLabel("Nom").fill(customRole);
    await fresh.getByLabel("Greffe : valider ou refuser les photos").check();
    await fresh.getByRole("button", { name: "Créer le rôle" }).click();
    await expect(page.getByRole("form", { name: new RegExp(`^${customRole} ·`) })).toBeVisible();
    await grant.getByLabel("E-mail exact ou pseudo").fill(custom.email);
    await grant.getByLabel("Rôle").selectOption({ label: customRole });
    await grant.getByRole("button", { name: "Donner le rôle" }).click();
    await expect.poll(() => roleOf(custom.id)).toBe(customRole);
    // The decision recorded: the page again, from a clean load.
    await page.goto("/admin/equipe");
    // team.manage is not a box.
    await expect(page.getByLabel("Équipe : gérer (super admin)")).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);

    // Coco leaves the site as a member: profile withdrawn, its request closed.
    expect(asOwner(`select hidden_reason from public.profiles where id = '${coco.id}'`)).toBe(
      "staff",
    );
    expect(
      asOwner(
        `select status || '/' || close_reason from public.visit_requests where id = '${requestId}'`,
      ),
    ).toBe("closed/staff_role");
    await page.context().close();
  });

  test("Observateur (Coco): read only, 403 elsewhere, no member area", async ({ browser }) => {
    const page = await signedIn(browser, coco);
    await expect(page).toHaveURL(/\/admin$/);
    expect(await menuEntries(page)).toEqual([
      "Tableau de bord",
      "Membres",
      "Historique",
      "Voir comme un Visiteur",
    ]);
    expect(await axeViolations(page)).toEqual([]);
    await expectForbidden(page, "/admin/greffe");
    expect(await axeViolations(page)).toEqual([]);
    await expectForbidden(page, "/admin/equipe");
    // The member area is closed while the role is held.
    await page.goto("/ma-fiche");
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/vue");
    await expect(page.getByRole("note", { name: "Vue Greffe : lecture seule" })).toBeVisible();
    await page.context().close();
  });

  test("Modérateur: the Greffe, the reports, the texts; not the content nor the team", async ({
    browser,
  }) => {
    const page = await signedIn(browser, moderator);
    const entries = await menuEntries(page);
    for (const entry of [
      "Greffe (photos)",
      "Signalements",
      "Textes signalés",
      "Mots-clés",
      "Corrections d'âge",
    ]) {
      expect(entries).toContain(entry);
    }
    for (const entry of [
      "Quartiers",
      "Questions (Interrogatoire)",
      "Signes distinctifs",
      "Équipe",
      "Historique",
      "Performance",
    ]) {
      expect(entries).not.toContain(entry);
    }
    await page.goto("/admin/greffe");
    await expect(page.getByRole("heading", { name: "Le Greffe" })).toBeVisible();
    await expectForbidden(page, "/admin/quartiers");
    await expectForbidden(page, "/admin/historique");
    await page.context().close();
  });

  test("Admin: everything but the team", async ({ browser }) => {
    const page = await signedIn(browser, full);
    const entries = await menuEntries(page);
    expect(entries).toContain("Quartiers");
    expect(entries).toContain("Historique");
    expect(entries).not.toContain("Équipe");
    expect((await page.goto("/admin/quartiers"))?.status()).toBe(200);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expectForbidden(page, "/admin/equipe");
    await page.context().close();
  });

  test("A role of its own (the Greffe only): lands on the Greffe, nothing else", async ({
    browser,
  }) => {
    const page = await signedIn(browser, custom);
    await expect(page).toHaveURL(/\/admin\/greffe$/);
    expect(await menuEntries(page)).toEqual(["Greffe (photos)"]);
    await expect(page.getByRole("button", { name: "Rechercher un membre" })).toHaveCount(0);
    await expectForbidden(page, "/admin/membres");
    await page.context().close();
  });

  test("The role taken back: Coco is a member again, as before; Historique tells it all", async ({
    browser,
  }) => {
    const page = await signedIn(browser, boss);
    await page.goto("/admin/equipe");
    const row = page.getByRole("listitem").filter({ hasText: coco.pseudo });
    await row.getByRole("button", { name: "Retirer le rôle" }).click();
    await expect
      .poll(() =>
        asOwner(
          `select coalesce(hidden_reason, 'none') from public.profiles where id = '${coco.id}'`,
        ),
      )
      .toBe("none");
    // The decision recorded: the page again, from a clean load.
    await page.goto("/admin/equipe");
    await page.goto("/admin/historique");
    const log = page.getByRole("region", { name: "Équipe" });
    await expect(log.getByText("Rôle retiré").first()).toBeVisible();
    await expect(log.getByText("Rôle créé").first()).toBeVisible();
    await expect(log.getByText(new RegExp(`Avant : Observateur`)).first()).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.context().close();
  });
});
