import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import sharp from "sharp";

// Full onboarding against the DEV Supabase project, with a throwaway confirmed account created
// through the admin API (no e-mail sent) and deleted afterwards. Opt-in: E2E_ALLOW_WRITE=true.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const enabled = process.env.E2E_ALLOW_WRITE === "true" && url !== "" && secret !== "";

test.describe("complete onboarding (real Supabase, writes data)", () => {
  test.skip(!enabled, "E2E_ALLOW_WRITE / SUPABASE_SECRET_KEY not set");
  test.use({ viewport: { width: 390, height: 900 } });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const email = `e2e-${randomBytes(4).toString("hex")}@example.com`;
  const password = `Pw-${randomBytes(12).toString("base64url")}`;
  let userId = "";

  test.beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
  });

  test.afterAll(async () => {
    if (!userId) return;
    const { data: files } = await admin.storage.from("photos-pending").list(userId);
    if (files?.length)
      await admin.storage.from("photos-pending").remove(files.map((f) => `${userId}/${f.name}`));
    await admin.auth.admin.deleteUser(userId);
  });

  test("steps 1 → 4 reach the city page, with consents and a metadata-free photo", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const photo = await sharp({
      create: { width: 1600, height: 2000, channels: 3, background: "#7a4a2a" },
    })
      .jpeg()
      .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "43/1 7/1 0/1" } })
      .toBuffer();
    const started = Date.now();

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
    await page.getByLabel("Femme").check();
    await page.getByRole("combobox").fill("toulon");
    await page.getByRole("option", { name: /^Toulon\s*83000$/ }).click();
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.waitForURL(/onboarding\/3/, { waitUntil: "commit" });

    await page.getByLabel("Homme").check();
    await page.getByLabel("Âge minimum").fill("25");
    await page.getByLabel("Âge maximum").fill("45");
    await page.locator("#consent").check();
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.waitForURL(/onboarding\/4/, { waitUntil: "commit" });

    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "moi.jpg", mimeType: "image/jpeg", buffer: photo });
    await expect(page.getByRole("img", { name: "Aperçu de ta photo" })).toBeVisible();
    await page.getByRole("button", { name: "Terminer" }).click();
    await page.waitForURL(/ville-bientot|ma-fiche/, { waitUntil: "commit" });
    const elapsed = (Date.now() - started) / 1000;
    console.log(`Onboarding automated run: ${elapsed.toFixed(1)} s`);

    const { data: profile } = await admin.from("profiles").select("*").eq("id", userId).single();
    expect(profile?.onboarding_completed_at).not.toBeNull();
    expect(profile?.zone_id).not.toBeNull();
    const { data: consents } = await admin
      .from("consents")
      .select("type, granted")
      .eq("user_id", userId);
    expect(consents?.map((c) => c.type).sort()).toEqual([
      "age_18",
      "art9_seeking",
      "privacy",
      "terms",
    ]);

    // City waitlist page: zone gauge and referral link.
    await page.goto("/ville-bientot");
    await expect(page.getByText("Zone : Toulon")).toBeVisible();
    await expect(page.getByLabel("Ton lien de parrainage")).toHaveValue(
      /\/inscription\?parrain=[A-Z2-9]{8}$/,
    );
    const axeCity = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axeCity.violations.map((v) => v.id)).toEqual([]);

    // Ma Fiche: moderation status, gauge, preview, then a bio + distinctive sign saved.
    await page.goto("/ma-fiche");
    await expect(page.getByText(/en cours de vérification/)).toBeVisible();
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
    const axeFiche = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      axeFiche.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
      ),
    ).toEqual([]);

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
});
