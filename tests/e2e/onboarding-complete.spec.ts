import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import sharp from "sharp";

// Full onboardings (Bad and Visitor, SPEC v7 §4) against the DEV Supabase project, with throwaway
// confirmed accounts created through the admin API (no e-mail sent) and deleted afterwards.
// Opt-in: E2E_ALLOW_WRITE=true.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const enabled = process.env.E2E_ALLOW_WRITE === "true" && url !== "" && secret !== "";
const WCAG = ["wcag2a", "wcag2aa", "wcag21aa"];

async function axeViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}

async function photoWithGps() {
  return sharp({ create: { width: 1600, height: 2000, channels: 3, background: "#7a4a2a" } })
    .jpeg()
    .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "43/1 7/1 0/1" } })
    .toBuffer();
}

/** Login, then the common steps 1 (age, rules) and 2 (identity in Toulon). */
async function commonSteps(page: Page, email: string, password: string, gender: string) {
  await page.goto("/connexion");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/onboarding\/1/, { waitUntil: "commit" });

  await page.getByLabel("Date de naissance").fill("1990-04-21");
  await page.getByLabel("J'atteste avoir 18 ans ou plus.").check();
  await page.locator("#terms").check();
  await page.locator("#privacy").check();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.waitForURL(/onboarding\/2/, { waitUntil: "commit" });

  await page.getByLabel("Pseudo").fill(`Test ${randomBytes(3).toString("hex")}`);
  await page.getByLabel(gender, { exact: true }).check();
  await page.getByRole("combobox").fill("toulon");
  await page.getByRole("option", { name: /^Toulon\s*83000$/ }).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.waitForURL(/onboarding\/3/, { waitUntil: "commit" });
}

async function seekingStep(page: Page, gender: string) {
  await page.getByLabel(gender, { exact: true }).check();
  await page.getByLabel("Âge minimum").fill("25");
  await page.getByLabel("Âge maximum").fill("45");
  await page.locator("#consent").check();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.waitForURL(/onboarding\/5/, { waitUntil: "commit" });
}

async function choosePhoto(page: Page) {
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "moi.jpg", mimeType: "image/jpeg", buffer: await photoWithGps() });
  await expect(page.getByRole("img", { name: "Aperçu de ta photo" })).toBeVisible();
}

test.describe("complete onboardings (real Supabase, writes data)", () => {
  test.skip(!enabled, "E2E_ALLOW_WRITE / SUPABASE_SECRET_KEY not set");
  test.use({ viewport: { width: 390, height: 900 } });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const accounts: string[] = [];

  async function newAccount(metadata: Record<string, string>) {
    const email = `e2e-${randomBytes(4).toString("hex")}@example.com`;
    const password = `Pw-${randomBytes(12).toString("base64url")}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error) throw error;
    accounts.push(data.user.id);
    return { email, password, userId: data.user.id };
  }

  test.afterAll(async () => {
    for (const userId of accounts) {
      const { data: files } = await admin.storage.from("photos-pending").list(userId);
      if (files?.length)
        await admin.storage.from("photos-pending").remove(files.map((f) => `${userId}/${f.name}`));
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("Bad: the door preselects the role; 5 steps reach the quarter page", async ({ page }) => {
    test.setTimeout(120_000);
    const { email, password, userId } = await newAccount({ role: "bad" });
    const started = Date.now();
    await commonSteps(page, email, password, "Femme");

    await expect(page.getByRole("heading", { name: "Ton rôle" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Je suis Bad/ })).toBeChecked();
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.waitForURL(/onboarding\/4/, { waitUntil: "commit" });

    await expect(page.getByRole("heading", { name: "Qui tu cherches" })).toBeVisible();
    await seekingStep(page, "Homme");
    await choosePhoto(page);
    await page.getByRole("button", { name: "Terminer" }).click();
    await page.waitForURL(/quartier|ma-fiche/, { waitUntil: "commit" });
    console.log(`Bad onboarding automated run: ${((Date.now() - started) / 1000).toFixed(1)} s`);

    const { data: profile } = await admin.from("profiles").select("*").eq("id", userId).single();
    expect(profile?.role).toBe("bad");
    expect(profile?.onboarding_completed_at).not.toBeNull();
    expect(profile?.zone_id).not.toBeNull();
    const { data: consents } = await admin
      .from("consents")
      .select("type, text_version")
      .eq("user_id", userId);
    expect(consents?.map((c) => c.type).sort()).toEqual([
      "age_18",
      "art9_seeking",
      "privacy",
      "terms",
    ]);
    expect(consents?.find((c) => c.type === "art9_seeking")?.text_version).toBe("art9-seeking-v2");

    // Quarter page: three floors, Visitors waiting (shown to Bads), referral link.
    await page.goto("/quartier");
    await expect(page.getByRole("heading", { name: "Ton quartier ouvre bientôt" })).toBeVisible();
    await expect(page.getByText("Quartier : Toulon")).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveCount(3);
    await expect(page.getByText(/Visiteur/)).toBeVisible();
    await expect(page.getByLabel("Ton lien de parrainage")).toHaveValue(
      /\/inscription\?parrain=[A-Z2-9]{8}$/,
    );
    expect(await axeViolations(page)).toEqual([]);

    // Ma Fiche: Greffe status, gauge, preview, then a bio + distinctive sign saved.
    await page.goto("/ma-fiche");
    await expect(page.getByRole("heading", { name: "Ma Fiche", level: 1 })).toBeVisible();
    await expect(page.getByText(/est au Greffe/)).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    await page
      .getByLabel("Présentation")
      .fill("Motarde le week-end, tatoueuse en semaine. Écris-moi : moi@mail.fr");
    await page.getByLabel("Biker").check();
    await page.getByLabel("Précision pour « Biker »").fill("Kawasaki Z650");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Fiche enregistrée.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("article").getByText("Biker — Kawasaki Z650")).toBeVisible();
    await expect(page.getByRole("article").getByText("Écris-moi : [•••]")).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    expect(await axeViolations(page)).toEqual([]);

    const { data: row } = await admin
      .from("photos")
      .select("pending_path, status")
      .eq("owner_id", userId)
      .single();
    expect(row?.status).toBe("pending");
    for (const path of [row!.pending_path!, row!.pending_path!.replace(/\.webp$/, "-s.webp")]) {
      const { data: blob } = await admin.storage.from("photos-pending").download(path);
      const meta = await sharp(Buffer.from(await blob!.arrayBuffer())).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.exif).toBeUndefined();
    }
  });

  test("Visitor: role chosen at step 3, Motif de visite, Permis pending at the Greffe", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { email, password, userId } = await newAccount({});
    const started = Date.now();
    await commonSteps(page, email, password, "Homme");

    // No door: nothing preselected, the role is required.
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByText("Choisis ton rôle pour continuer.")).toBeVisible();
    await page.getByRole("radio", { name: /Je viens visiter/ }).check();
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.waitForURL(/onboarding\/4/, { waitUntil: "commit" });

    await expect(page.getByRole("heading", { name: "Qui tu viens voir" })).toBeVisible();
    await seekingStep(page, "Femme");
    await choosePhoto(page);
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.waitForURL(/onboarding\/6/, { waitUntil: "commit" });

    await page.getByRole("button", { name: "Terminer" }).click();
    await expect(page.getByText("Écris ton Motif de visite pour continuer.")).toBeVisible();
    await page
      .getByLabel("Motif de visite")
      .fill("Fan de rock et de virées de nuit. Mon 06 12 34 56 78 ne sortira pas d'ici.");
    await page.getByRole("button", { name: "Terminer" }).click();
    await page.waitForURL(/quartier|ma-fiche/, { waitUntil: "commit" });
    console.log(
      `Visitor onboarding automated run: ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );

    const { data: profile } = await admin.from("profiles").select("*").eq("id", userId).single();
    expect(profile?.role).toBe("visitor");
    expect(profile?.onboarding_completed_at).not.toBeNull();
    expect(profile?.visit_motive).toContain("[•••]");
    expect(profile?.visit_motive).not.toContain("06 12");

    // Visitors do not get the Visitors count.
    await page.goto("/quartier");
    await expect(page.getByText("Quartier : Toulon")).toBeVisible();
    await expect(page.getByText(/attendent l'ouverture|attend l'ouverture/)).toHaveCount(0);

    await page.goto("/ma-fiche");
    await expect(
      page.getByRole("heading", { name: "Mon Permis de visite", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(/Permis en attente au Greffe/)).toBeVisible();
    const permit = page.getByRole("article");
    await expect(permit.getByText("Nouveau visiteur")).toBeVisible();
    await expect(permit.getByText(/Fan de rock/)).toBeVisible();
    await expect(page.getByText("Remplacer ma photo")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
