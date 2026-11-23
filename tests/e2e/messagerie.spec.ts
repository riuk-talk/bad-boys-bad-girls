import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { adminMenu, openAdmin } from "./helpers/admin";
import { cutoutReady } from "./helpers/onboarding";
import { watchRealtimeRefusals } from "./helpers/realtime";
import { settled } from "./helpers/settle";

// La Messagerie du Greffe (10g), LOCAL STACK ONLY. A Modérateur writes to a Bad, who sees
// « Le Greffe · Sam » in their Courrier du Greffe and answers; both screens follow each other live
// (the answer, « … écrit », « Lu »); an image sent loses its metadata (the GPS of a phone); a
// retouched pose proposed by the team replaces the member's only after « Accepter ».
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

function asOwner(sql: string): string {
  return execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

/** Realtime subscriptions refused on any page of this file (there must be none). */
const refusals: string[] = [];

async function memberPage(browser: Browser, email: string, password: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  watchRealtimeRefusals(page, refusals);
  await page.goto("/connexion");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((target) => !/^\/(connexion|onboarding)$/.test(target.pathname));
  await expect(page.locator("main h1").first()).toBeVisible();
  if ((await page.locator("[data-cutout-engine]").count()) > 0) await cutoutReady(page);
  return page;
}

test.describe("Messagerie du Greffe (10g, local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const accounts: string[] = [];
  const team = { email: "", password: "", id: "", totpSecret: "" };
  const rose = { email: "", password: "", id: "", pseudo: `Rose${randomBytes(2).toString("hex")}` };
  const teamName = `Sam${randomBytes(1).toString("hex")}`;
  let placeId = 0;
  let threadId = "";

  async function account(target: { email: string; password: string; id: string }) {
    target.email = `e2e-mail-${randomBytes(4).toString("hex")}@example.com`;
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

  test.beforeAll(async () => {
    const { data: place, error: placeError } = await admin
      .from("places")
      .insert({
        official_code: `E2E${randomBytes(3).toString("hex")}`,
        name: "Port-Courrier",
        lat: 46.5,
        lng: -8.4,
      })
      .select("id")
      .single();
    if (placeError) throw placeError;
    placeId = place.id;
    await account(team);
    // The Modérateur role (members.message is one of its boxes).
    asOwner(`insert into public.admin_users (user_id, role_id) values ('${team.id}', 2)`);
    await account(rose);
    const { error } = await admin.from("profiles").insert({
      id: rose.id,
      pseudo: rose.pseudo,
      birthdate: "1990-05-05",
      gender: "woman",
      seeking_genders: ["man"],
      place_id: placeId,
      role: "bad",
    });
    if (error) throw error;
    const { error: doneError } = await admin
      .from("profiles")
      .update({ onboarding_completed_at: new Date().toISOString(), onboarding_step: 8 })
      .eq("id", rose.id);
    if (doneError) throw doneError;
  });

  test.afterAll(() => {
    asOwner(
      `delete from public.admin_users where user_id = any (array[${accounts.map((id) => `'${id}'`).join(",")}]::uuid[])`,
    );
    for (const id of accounts) asOwner(`delete from auth.users where id = '${id}'`);
    if (placeId) asOwner(`delete from public.places where id = ${placeId}`);
  });

  test.afterEach(() => {
    expect(refusals.splice(0), "no Realtime subscription refused").toEqual([]);
  });

  test("the team writes, the member reads and answers, live: « … écrit », « Lu »", async ({
    browser,
  }) => {
    const staff = await (await browser.newContext()).newPage();
    watchRealtimeRefusals(staff, refusals);
    team.totpSecret = await openAdmin(staff, team);
    await adminMenu(staff, /^Messagerie/);
    await expect(staff.getByRole("heading", { name: "Messagerie", level: 1 })).toBeVisible();
    // The name the team signs with.
    await staff.getByLabel(/Prénom ou pseudo d'équipe/).fill(teamName);
    await staff.getByRole("button", { name: "Enregistrer" }).click();
    await expect(staff.getByText("Décision enregistrée.")).toBeVisible();
    // A new thread, by the member's pseudo.
    await staff.getByLabel("Membre", { exact: true }).fill(rose.pseudo);
    await staff.getByRole("button", { name: "Écrire", exact: true }).click();
    await staff.waitForURL(/\/admin\/messagerie\/[0-9a-f-]{36}$/);
    threadId = staff.url().split("/").pop()!;
    await expect(staff.getByRole("heading", { name: `Fil avec ${rose.pseudo}` })).toBeVisible();
    await staff.getByLabel("Ton message").fill("Bonjour, ta pose de profil est floue.");
    await staff.getByRole("button", { name: "Envoyer" }).click();
    const sent = staff
      .getByRole("list", { name: "Messages du fil" })
      .getByText("Bonjour, ta pose de profil est floue.");
    await expect(sent).toBeVisible();
    expect(await axeViolations(staff)).toEqual([]);

    // The member: the banner of Ma fiche, then the Courrier du Greffe.
    const member = await memberPage(browser, rose.email, rose.password);
    await member.goto("/ma-fiche");
    const banner = member.getByTestId("greffe-banner");
    await expect(banner).toContainText("Le Greffe t'a écrit : 1 message non lu.");
    await banner.click();
    await member.waitForURL(/\/ma-fiche\/courrier-du-greffe$/);
    await expect(
      member.getByRole("heading", { name: "Courrier du Greffe", level: 1 }),
    ).toBeVisible();
    const received = member.getByRole("list", { name: "Messages du fil" });
    await expect(received.getByText("Bonjour, ta pose de profil est floue.")).toBeVisible();
    await expect(received.getByText(`Le Greffe · ${teamName}`)).toBeVisible();
    expect(await axeViolations(member)).toEqual([]);

    // « Lu » on the team's screen, live (the member's screen marked the message read).
    await staff.bringToFront();
    await expect(staff.getByTestId("greffe-read")).toHaveText("Lu", { timeout: 10_000 });

    // « … écrit » then the answer, live on the team's screen.
    await member.bringToFront();
    const field = member.getByLabel("Ton message");
    await field.click();
    await field.pressSequentially("Je la refais ce soir", { delay: 40 });
    await staff.bringToFront();
    await expect(staff.getByTestId("greffe-typing")).toHaveText(`${rose.pseudo} écrit…`, {
      timeout: 10_000,
    });
    await member.bringToFront();
    await member.getByRole("button", { name: "Envoyer" }).click();
    await expect(received.getByText("Je la refais ce soir")).toBeVisible();
    await staff.bringToFront();
    await expect(
      staff.getByRole("list", { name: "Messages du fil" }).getByText("Je la refais ce soir"),
    ).toBeVisible({ timeout: 10_000 });

    // The team's message: never editable nor deletable, tied to its real author.
    expect(
      asOwner(
        `select author_id from public.greffe_messages where thread_id = '${threadId}' and side = 'team'`,
      ),
    ).toBe(team.id);
    // Every opening by the team is logged.
    expect(
      Number(
        asOwner(
          `select count(*) from public.greffe_fiche_views where admin_id = '${team.id}' and context = 'messagerie'`,
        ),
      ),
    ).toBeGreaterThan(0);
    await member.context().close();
    await staff.context().close();
  });

  test("an image: compressed, without its metadata (GPS), shown to the two sides only", async ({
    browser,
  }) => {
    // A phone's photo: a JPEG with its position in the EXIF.
    const photo = await sharp({
      create: { width: 1200, height: 900, channels: 3, background: { r: 120, g: 80, b: 60 } },
    })
      .withExif({
        IFD0: { Make: "Phone" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "43/1 7/1 0/1" },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(photo).metadata()).exif).toBeDefined();

    const member = await memberPage(browser, rose.email, rose.password);
    await member.goto("/ma-fiche/courrier-du-greffe");
    await member
      .getByTestId("greffe-files")
      .setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: photo });
    await expect(member.getByText("1 image choisie")).toBeVisible();
    await member.getByLabel("Ton message").fill("Voilà la lumière de ma cellule.");
    await member.getByRole("button", { name: "Envoyer" }).click();
    const image = member.getByTestId("greffe-image");
    await expect(image).toBeVisible();
    await expect(image).toHaveJSProperty("complete", true);
    expect(await image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(
      0,
    );
    expect(await axeViolations(member)).toEqual([]);

    const path = asOwner(
      `select a.path from public.greffe_attachments a where a.thread_id = '${threadId}' order by a.created_at desc limit 1`,
    );
    expect(path.startsWith(`${rose.id}/`)).toBe(true);
    const { data: stored, error } = await admin.storage.from("greffe-mail").download(path);
    if (error) throw error;
    const meta = await sharp(Buffer.from(await stored.arrayBuffer())).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif, "no EXIF (no GPS) in the stored image").toBeUndefined();
    // The bucket is private: no public address.
    const response = await member.request.get(
      `${url}/storage/v1/object/public/greffe-mail/${path}`,
    );
    expect(response.ok()).toBe(false);
    await member.context().close();
  });

  test("a retouched pose: proposed by the team, replaces the member's only after « Accepter »", async ({
    browser,
  }) => {
    const staff = await (await browser.newContext()).newPage();
    watchRealtimeRefusals(staff, refusals);
    await openAdmin(staff, team);
    await staff.goto(`/admin/messagerie/${threadId}`);
    await expect(staff.getByRole("heading", { name: `Fil avec ${rose.pseudo}` })).toBeVisible();
    // A cut-out photo (transparent around the subject), for the left profile.
    const cutout = await sharp({
      create: { width: 900, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 500,
              height: 900,
              channels: 4,
              background: { r: 200, g: 150, b: 120, alpha: 1 },
            },
          })
            .png()
            .toBuffer(),
          top: 200,
          left: 200,
        },
      ])
      .png()
      .toBuffer();
    const form = staff.getByRole("form", { name: "Proposer une photo retouchée" });
    await form.getByLabel("Pour la pose").selectOption("1");
    await form
      .getByTestId("propose-file")
      .setInputFiles({ name: "profil.png", mimeType: "image/png", buffer: cutout });
    await form.getByLabel("Mot pour le membre (facultatif)").fill("Recadrée et éclaircie.");
    await form.getByRole("button", { name: "Proposer la photo" }).click();
    await expect(form.getByText("Photo proposée au membre.")).toBeVisible();
    expect(
      asOwner(`select count(*) from public.photos where owner_id = '${rose.id}' and position = 1`),
      "nothing replaced before the member's answer",
    ).toBe("0");

    const member = await memberPage(browser, rose.email, rose.password);
    await member.goto("/ma-fiche/courrier-du-greffe");
    const proposal = member.getByTestId("greffe-proposal");
    await expect(proposal).toContainText("Photo proposée par le Greffe : Profil gauche");
    await expect(proposal).toContainText("Rien ne change sans ton accord.");
    expect(await axeViolations(member)).toEqual([]);
    await proposal.getByRole("button", { name: "Accepter" }).click();
    await expect(proposal).toContainText("Acceptée : elle remplace ta pose.");
    expect(
      asOwner(
        `select status || '/' || reviewed_by || '/' || is_cutout from public.photos where owner_id = '${rose.id}' and position = 1`,
      ),
      "the pose replaced, validated at once by its proposer, cut out",
    ).toBe(`approved/${team.id}/true`);
    expect(
      asOwner(
        `select count(*) from public.moderation_actions where target_user_id = '${rose.id}' and action = 'photo_proposal_accept'`,
      ),
      "logged",
    ).toBe("1");
    // The team sees the answer.
    await staff.bringToFront();
    await expect(
      staff.getByRole("list", { name: "Messages du fil" }).getByText("Photo proposée acceptée."),
    ).toBeVisible({ timeout: 15_000 });
    await member.context().close();
    await staff.context().close();
  });

  test("a visible Bad stays visible while a new pose waits for the Greffe (10-50 corrected)", async ({
    browser,
  }) => {
    // Rose's Fiche online: her 3 poses validated (the left profile is the accepted proposal), her
    // Casier, seen today.
    for (const position of [0, 2]) {
      asOwner(
        `insert into public.photos (owner_id, position, pending_path) values ('${rose.id}', ${position}, '${rose.id}/p${position}.webp')`,
      );
    }
    asOwner(
      `update public.photos set status = 'approved', pending_path = null, is_cutout = true,
         public_path_large = gen_random_uuid() || '.webp', public_path_small = gen_random_uuid() || '-s.webp'
       where owner_id = '${rose.id}' and status = 'pending'`,
    );
    asOwner(
      `insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index)
       values ('${rose.id}', 'Vol de lune', 'Excès de charme', 'Retard chronique', 1)
       on conflict (profile_id) do nothing`,
    );
    asOwner(`update public.profiles set last_seen_at = now() where id = '${rose.id}'`);
    const left = asOwner(
      `select public_path_large from public.photos where owner_id = '${rose.id}' and position = 1 and status = 'approved'`,
    );

    const staff = await (await browser.newContext()).newPage();
    watchRealtimeRefusals(staff, refusals);
    await openAdmin(staff, team);
    const leftPose = async () => {
      await staff.goto(`/admin/vue/fiche/${rose.id}`);
      const fiche = staff.getByTestId("fiche");
      await expect(fiche.getByTestId("pose-left")).toBeVisible();
      return fiche.getByTestId("pose-left").locator("img").first().getAttribute("src");
    };
    expect(await leftPose(), "the Fiche is online, with its left profile").toContain(left);

    // Rose deposits a new left profile from her Courrier: it goes to the Greffe's queue.
    const photo = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: { r: 90, g: 90, b: 110 } },
    })
      .jpeg()
      .toBuffer();
    const member = await memberPage(browser, rose.email, rose.password);
    await member.goto("/ma-fiche/courrier-du-greffe");
    await member.getByLabel("Photo jointe").selectOption("1");
    await member
      .getByTestId("greffe-files")
      .setInputFiles({ name: "profil.jpg", mimeType: "image/jpeg", buffer: photo });
    await member.getByRole("button", { name: "Envoyer" }).click();
    await expect(
      member
        .getByRole("list", { name: "Messages du fil" })
        .getByText("Photo déposée au Greffe : Profil gauche."),
    ).toBeVisible();
    expect(
      asOwner(
        `select string_agg(status::text, ',' order by status::text) from public.photos where owner_id = '${rose.id}' and position = 1`,
      ),
      "the new pose waits beside the validated one",
    ).toBe("approved,pending");

    // Still online, with the validated left profile, while the new one waits.
    expect(await leftPose(), "the Bad stays visible, the validated pose shown").toContain(left);
    // Her own Ma fiche says so.
    await member.goto("/ma-fiche");
    await expect(member.getByText(/nouvelle pose en attente du Greffe/)).toBeVisible();
    // Target sizes measured with the tab bar in the flow, as the journey's sweep does (9 ter):
    // content scrolled under a sticky bar is not a small target.
    await member.addStyleTag({ content: "[data-tab-bar] { position: static !important; }" });
    expect(await axeViolations(member)).toEqual([]);
    await member.context().close();
    await staff.context().close();
  });
});
