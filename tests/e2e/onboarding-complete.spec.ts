import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import sharp from "sharp";

// Full onboardings in 8 steps (Bad and Visitor, SPEC v7.4 §4) and the Greffe against the DEV Supabase project, with throwaway
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

async function seekingStep(page: Page, gender: string, next: number) {
  await page.getByLabel(gender, { exact: true }).check();
  await page.getByLabel("Âge minimum").fill("25");
  await page.getByLabel("Âge maximum").fill("45");
  await page.locator("#consent").check();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.waitForURL(new RegExp(`onboarding/${next}`), { waitUntil: "commit" });
}

async function choosePhoto(page: Page) {
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "moi.jpg", mimeType: "image/jpeg", buffer: await photoWithGps() });
  await expect(page.getByRole("img", { name: "Aperçu de ta photo" })).toBeVisible();
}

/** Bad, step 5 « Passe à la toise »: one file per pose (uploaded as soon as chosen). */
async function addPose(page: Page, pose: "Profil gauche" | "Face · obligatoire" | "Profil droit") {
  await page
    .getByLabel(`Ajouter : ${pose}`)
    .setInputFiles({ name: `${pose}.jpg`, mimeType: "image/jpeg", buffer: await photoWithGps() });
  await expect(page.getByRole("img", { name: `Ta photo : ${pose}` })).toBeVisible();
}

/** Step 8 « L'Interrogatoire »: the first option of each of the 10 core questions. */
async function interrogation(page: Page, finish: string) {
  await expect(page.getByText("Interrogatoire · 1/10")).toBeVisible();
  await page.getByRole("button", { name: "Question suivante" }).click();
  await expect(page.getByText("Choisis une réponse pour continuer.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  for (let index = 1; index <= 10; index += 1) {
    await expect(page.getByText(`Interrogatoire · ${index}/10`)).toBeVisible();
    await page.getByRole("radio").first().check({ force: true });
    if (index === 3) {
      // « Affiner »: accept only one answer from the other person, marked essential.
      await page.locator("summary", { hasText: "Affiner" }).click();
      for (const box of await page.getByRole("checkbox").all()) await box.uncheck({ force: true });
      await page.getByRole("checkbox").first().check({ force: true });
      await page.getByRole("radio", { name: "Indispensable" }).check({ force: true });
    }
    await page.getByRole("button", { name: index === 10 ? finish : "Question suivante" }).click();
    if (index < 10)
      await page.waitForURL(new RegExp(`onboarding/8\\?q=${index + 1}`), { waitUntil: "commit" });
  }
}

test.describe("complete onboardings (real Supabase, writes data)", () => {
  test.skip(!enabled, "E2E_ALLOW_WRITE / SUPABASE_SECRET_KEY not set");
  test.use({ viewport: { width: 390, height: 900 } });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const accounts: string[] = [];
  const publicFiles: string[] = [];

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
    if (publicFiles.length) await admin.storage.from("photos").remove(publicFiles);
    for (const userId of accounts) {
      const { data: files } = await admin.storage.from("photos-pending").list(userId);
      if (files?.length)
        await admin.storage.from("photos-pending").remove(files.map((f) => `${userId}/${f.name}`));
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("Bad: 8 steps — 3 poses, Casier, « Teste ton Casier », L'Interrogatoire", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const { email, password, userId } = await newAccount({ role: "bad" });
    const started = Date.now();
    await commonSteps(page, email, password, "Femme");

    // A woman: the interface is red (PARCOURS-DESIGN §1); the role reads « BAD » in the header.
    await expect(page.locator('[data-accent="red"]')).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Ton rôle" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Je suis Bad/ })).toBeChecked();
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.waitForURL(/onboarding\/4/, { waitUntil: "commit" });
    await expect(page.getByText("BAD", { exact: true })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Qui tu cherches" })).toBeVisible();
    await seekingStep(page, "Homme", 5);

    // Step 5: the 3 poses are required.
    await expect(page.getByRole("heading", { name: "Passe à la toise" })).toBeVisible();
    await addPose(page, "Profil gauche");
    await addPose(page, "Face · obligatoire");
    await page.getByRole("button", { name: "Déposer au Greffe" }).click();
    await expect(page.getByText(/Il manque une pose/)).toBeVisible();
    await addPose(page, "Profil droit");
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Déposer au Greffe" }).click();
    await page.waitForURL(/onboarding\/6/, { waitUntil: "commit" });

    // Step 6: the Casier assistant, the true line first; a duplicate is refused.
    await expect(page.getByRole("heading", { name: "Un vrai, deux faux." })).toBeVisible();
    await page.getByRole("button", { name: "Moto", exact: true }).click();
    await expect(page.getByText(/sa moto|à moto/).first()).toBeVisible();
    const trueLine =
      "A traversé l'Espagne à moto sans réserver une seule nuit, en plein mois d'août, seule.";
    await page.getByLabel("Chef d'accusation n° 1 · Le vrai").fill(trueLine);
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Suivant : le premier faux" }).click();
    await page.getByLabel("Chef d'accusation n° 2 · Un faux").fill("A un tatouage secret.");
    await page.getByRole("button", { name: "Suivant : le second faux" }).click();
    await page.getByLabel("Chef d'accusation n° 3 · Un faux").fill("a un  TATOUAGE secret.");
    await expect(page.getByText(/Deux chefs d'accusation sont identiques/)).toBeVisible();
    await page
      .getByLabel("Chef d'accusation n° 3 · Un faux")
      .fill("S'est fait sortir d'un karaoké.");
    await page.getByRole("button", { name: "Voir mon Casier" }).click();
    await page.waitForURL(/onboarding\/7/, { waitUntil: "commit" });

    // Step 7: the true line labelled for its author only; the long line is flagged (± 40 %).
    await expect(page.getByText("Le vrai · visible par toi seul")).toHaveCount(1);
    await expect(page.getByText(/beaucoup plus longue que les deux autres/)).toBeVisible();
    await expect(page.getByText("Les conseils du Souffleur")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("link", { name: "Le retravailler" }).click();
    await page.waitForURL(/onboarding\/6/, { waitUntil: "commit" });
    await expect(page.getByLabel("Chef d'accusation n° 1 · Le vrai")).toHaveValue(trueLine);
    await page
      .getByLabel("Chef d'accusation n° 1 · Le vrai")
      .fill("A traversé l'Espagne à moto sans réserver.");
    await page.getByRole("button", { name: "Suivant : le premier faux" }).click();
    await page.getByRole("button", { name: "Suivant : le second faux" }).click();
    await page.getByRole("button", { name: "Voir mon Casier" }).click();
    await page.waitForURL(/onboarding\/7/, { waitUntil: "commit" });
    await page.getByRole("button", { name: "Mon Casier est prêt" }).click();
    await page.waitForURL(/onboarding\/8/, { waitUntil: "commit" });

    // Step 8: L'Interrogatoire ends the Dossier.
    await interrogation(page, "Terminer mon Dossier");
    await page.waitForURL(/quartier|ma-fiche/, { waitUntil: "commit" });
    console.log(`Bad onboarding automated run: ${((Date.now() - started) / 1000).toFixed(1)} s`);

    const { data: profile } = await admin.from("profiles").select("*").eq("id", userId).single();
    expect(profile?.role).toBe("bad");
    expect(profile?.onboarding_step).toBe(8);
    expect(profile?.onboarding_completed_at).not.toBeNull();
    const { data: casier } = await admin
      .from("casier_charges")
      .select("*")
      .eq("profile_id", userId)
      .single();
    const charges = [casier!.charge_1, casier!.charge_2, casier!.charge_3];
    expect(charges[casier!.true_index - 1]).toBe("A traversé l'Espagne à moto sans réserver.");
    const { data: answers } = await admin
      .from("answers")
      .select("question_id, accepted_option_ids, importance")
      .eq("user_id", userId);
    expect(answers).toHaveLength(10);
    expect(answers?.find((a) => a.question_id === 3)).toMatchObject({
      accepted_option_ids: [31],
      importance: "essential",
    });
    const { data: photos } = await admin
      .from("photos")
      .select("id, position, pending_path, status")
      .eq("owner_id", userId)
      .order("position");
    expect(photos?.map((p) => p.position)).toEqual([0, 1, 2]);
    for (const photo of photos ?? []) {
      const { data: blob } = await admin.storage
        .from("photos-pending")
        .download(photo.pending_path!);
      const meta = await sharp(Buffer.from(await blob!.arrayBuffer())).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.exif).toBeUndefined();
    }

    // Ma Fiche: the 3 poses at the Greffe, the Casier on the preview, the shortcuts.
    await page.goto("/ma-fiche");
    await expect(page.getByText(/Tes 3 poses sont au Greffe/)).toBeVisible();
    await expect(page.getByRole("link", { name: "L'Interrogatoire (10/20)" })).toBeVisible();
    await expect(
      page.getByRole("article").getByText("S'est fait sortir d'un karaoké."),
    ).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // L'Interrogatoire from Ma Fiche: an extra question.
    await page.getByRole("link", { name: "L'Interrogatoire (10/20)" }).click();
    await page.getByRole("link", { name: /Tatouages/ }).click();
    await page.getByRole("radio").nth(1).check({ force: true });
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await page.waitForURL(/interrogatoire$/, { waitUntil: "commit" });
    await expect(page.getByText("11 questions sur 20")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // Le Greffe: an admin approves two poses and refuses one, each separately.
    const adminAccount = await newAccount({});
    await admin
      .from("profiles")
      .insert({
        id: adminAccount.userId,
        pseudo: `Greffier ${randomBytes(2).toString("hex")}`,
        birthdate: "1985-01-01",
      });
    await admin.from("admin_users").insert({ user_id: adminAccount.userId, note: "e2e" });
    const greffier = await (
      await browser.newContext({ viewport: { width: 1280, height: 900 } })
    ).newPage();
    await greffier.goto("/connexion");
    await greffier.getByLabel("E-mail").fill(adminAccount.email);
    await greffier.getByLabel("Mot de passe", { exact: true }).fill(adminAccount.password);
    await greffier.getByRole("button", { name: "Se connecter" }).click();
    await greffier.waitForURL(/onboarding/, { waitUntil: "commit" });
    await greffier.goto("/admin/greffe");
    await expect(greffier.getByRole("heading", { name: "Le Greffe" })).toBeVisible();
    expect(await axeViolations(greffier)).toEqual([]);
    const card = (pose: string) =>
      greffier
        .getByRole("listitem")
        .filter({ hasText: profile!.pseudo! })
        .filter({ hasText: pose });
    await card("Face").getByRole("button", { name: "Valider" }).click();
    await expect(greffier.getByText("Décision enregistrée.")).toBeVisible();
    await card("Profil gauche").getByRole("button", { name: "Valider" }).click();
    await expect(card("Profil gauche")).toHaveCount(0);
    await card("Profil droit").getByLabel("Motif du refus").selectOption("sunglasses");
    await card("Profil droit").getByRole("button", { name: "Refuser" }).click();
    await expect(card("Profil droit")).toHaveCount(0);
    await greffier.context().close();

    const { data: decided } = await admin
      .from("photos")
      .select(
        "position, status, pending_path, public_path_large, public_path_small, rejection_reason",
      )
      .eq("owner_id", userId)
      .order("position");
    expect(decided?.map((p) => p.status)).toEqual(["approved", "approved", "rejected"]);
    expect(decided?.[2]?.rejection_reason).toBe("sunglasses");
    for (const photo of decided ?? []) expect(photo.pending_path).toBeNull();
    for (const photo of decided!.slice(0, 2)) {
      expect(photo.public_path_large).toMatch(/^[0-9a-f-]{36}\.webp$/);
      expect(photo.public_path_large).not.toContain(userId);
      publicFiles.push(photo.public_path_large!, photo.public_path_small!);
      const { data: blob } = await admin.storage.from("photos").download(photo.public_path_large!);
      expect((await sharp(Buffer.from(await blob!.arrayBuffer())).metadata()).exif).toBeUndefined();
    }
    const { data: leftovers } = await admin.storage.from("photos-pending").list(userId);
    expect(leftovers ?? []).toHaveLength(0);

    // The Bad is told, pose by pose.
    await page.goto("/ma-fiche");
    await expect(page.getByText("Nouvelles du Greffe")).toBeVisible();
    await expect(
      page.getByText(/Profil droit : refusée \(lunettes de soleil sur la face\)/),
    ).toBeVisible();
    await expect(page.getByText(/Une de tes poses a été refusée/)).toBeVisible();
    await page.getByRole("button", { name: "Compris" }).click();
    await expect(page.getByText("Nouvelles du Greffe")).toHaveCount(0);
  });

  test("Visitor: role chosen at step 3, Motif de visite, Permis pending at the Greffe", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { email, password, userId } = await newAccount({});
    const started = Date.now();
    await commonSteps(page, email, password, "Homme");

    // No door: nothing preselected, the role is required.
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByText("Choisis ton rôle pour continuer.")).toBeVisible();
    await page.getByRole("radio", { name: /Je viens visiter/ }).check();
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.waitForURL(/onboarding\/4/, { waitUntil: "commit" });

    // « Entraîne-toi »: a wrong bet on the fictional Record reveals the true charge.
    await expect(page.getByText("Exemple fictif · Casier n° 000")).toBeVisible();
    await page.getByRole("button", { name: /traversé l'Espagne/ }).click();
    await expect(page.getByRole("img", { name: "RATÉ !" })).toBeVisible();
    await expect(page.getByText("Le vrai", { exact: true })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "J'ai compris, je prends mon Permis" }).click();
    await page.waitForURL(/onboarding\/5/, { waitUntil: "commit" });

    await expect(page.getByRole("heading", { name: "Qui tu viens voir" })).toBeVisible();
    await seekingStep(page, "Femme", 6);
    await choosePhoto(page);
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.waitForURL(/onboarding\/7/, { waitUntil: "commit" });

    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByText("Écris ton Motif de visite pour continuer.")).toBeVisible();
    await page
      .getByLabel("Motif de visite")
      .fill("Fan de rock et de virées de nuit. Mon 06 12 34 56 78 ne sortira pas d'ici.");
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.waitForURL(/onboarding\/8/, { waitUntil: "commit" });
    // A man: the interface stays gold (no accent override); the role reads « VISITEUR ».
    await expect(page.locator("[data-accent]")).toHaveCount(0);
    await expect(page.getByText("VISITEUR", { exact: true })).toBeVisible();
    await interrogation(page, "Terminer mon Permis");
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
