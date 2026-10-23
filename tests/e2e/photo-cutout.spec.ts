import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import { openGreffe } from "./helpers/admin";
import { confirmPhoto, identity, seeking, signUp } from "./helpers/onboarding";

// The photo on the height chart (owner's final decision 2026-10-23), LOCAL STACK ONLY: the same
// wall for everyone, no choice. A Bad at « Passe à la toise » sends a real portrait
// (tests/e2e/fixtures/person.jpg): cut out on the device, previewed, sent with its transparency.
// A pose the device could not cut out (runtime blocked) is sent as it is and waits for the
// Greffe, which cuts it out in the admin's browser before it can be validated. Then the batch of
// the photos validated before the decision (preview only, here the local stack).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const mailpit = process.env.MAILPIT_URL ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  secret !== "" &&
  mailpit !== "";

test.describe("photo cut-out in the browser (local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const bad = {
    email: `e2e-cutout-${randomBytes(4).toString("hex")}@example.com`,
    password: `Pw-${randomBytes(12).toString("base64url")}`,
    id: "",
  };
  const greffier = {
    email: `e2e-cutout-g-${randomBytes(4).toString("hex")}@example.com`,
    password: `Pw-${randomBytes(12).toString("base64url")}`,
    id: "",
    totpSecret: "",
  };
  const published: string[] = [];

  test.afterAll(async () => {
    await admin.from("app_settings").update({ photo_batch_allowed: false }).eq("id", true);
    if (bad.id) {
      const { data: rows } = await admin
        .from("photos")
        .select("public_path_large, public_path_small")
        .eq("owner_id", bad.id);
      for (const row of rows ?? []) {
        for (const path of [row.public_path_large, row.public_path_small])
          if (path) published.push(path);
      }
    }
    if (published.length) await admin.storage.from("photos").remove(published);
    for (const id of [bad.id, greffier.id].filter(Boolean)) {
      const { data: files } = await admin.storage.from("photos-pending").list(id);
      if (files?.length)
        await admin.storage.from("photos-pending").remove(files.map((f) => `${id}/${f.name}`));
      await admin.auth.admin.deleteUser(id);
    }
  });

  const photosOf = async () =>
    (
      await admin
        .from("photos")
        .select("id, position, status, is_cutout, needs_cutout, pending_path, public_path_large")
        .eq("owner_id", bad.id)
        .order("position")
    ).data ?? [];

  test("cut out on the device, or by the Greffe before validation: never as it is", async ({
    page,
    browser,
  }) => {
    const person = await readFile("tests/e2e/fixtures/person.jpg");
    await signUp(page, "Je suis Bad", bad, mailpit);
    await identity(page, `Toise${randomBytes(2).toString("hex")}`, "Femme");
    await seeking(page, "Homme", 5);
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
    bad.id = users.users.find((u) => u.email === bad.email)?.id ?? "";
    const dialog = page.getByRole("dialog", { name: "Ta photo sur le mur" });

    // Left profile: the device cannot cut it out (runtime blocked); the original goes to the Greffe.
    await page.route("**/vendor/mediapipe/**", (route) => route.abort());
    await page.reload();
    await page
      .getByLabel("Ajouter : Profil gauche")
      .setInputFiles({ name: "left.jpg", mimeType: "image/jpeg", buffer: person });
    await expect(dialog.getByText(/Le Greffe la détourera avant de la valider/)).toBeVisible({
      timeout: 60_000,
    });
    await expect(dialog.getByRole("button", { name: /telle quelle/i })).toHaveCount(0);
    const left = await confirmPhoto(page);
    expect(left).toMatchObject({ decision: "as_is", reason: "error" });
    await expect(page.getByText("Le Greffe la détoure")).toBeVisible({ timeout: 20_000 });
    await page.unroute("**/vendor/mediapipe/**");
    await page.reload();

    // Face: cut out on the device; « Changer de photo » first picks another file, then it is sent.
    await page
      .getByLabel("Ajouter : Face · obligatoire")
      .setInputFiles({ name: "first.jpg", mimeType: "image/jpeg", buffer: person });
    await expect(dialog.getByText(/sur ton appareil/)).toBeVisible();
    await dialog
      .getByLabel("Changer de photo")
      .setInputFiles({ name: "face.jpg", mimeType: "image/jpeg", buffer: person });
    const face = await confirmPhoto(page);
    console.log(`cut-out (face): ${face.decision} in ${face.ms} ms`);
    expect(face.decision).toBe("cutout");
    await expect(page.getByRole("img", { name: "Ta photo : Face · obligatoire" })).toBeVisible({
      timeout: 20_000,
    });

    expect((await photosOf()).map((p) => [p.position, p.is_cutout, p.needs_cutout])).toEqual([
      [0, true, false],
      [1, false, true],
    ]);
    // What was sent: WebP, under the bucket limit.
    for (const photo of await photosOf()) {
      const { data: blob } = await admin.storage
        .from("photos-pending")
        .download(photo.pending_path!);
      const bytes = Buffer.from(await blob!.arrayBuffer());
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(bytes.length).toBeLessThanOrEqual(262_144);
    }

    // The Greffe: the face may be validated; the left profile must be cut out first.
    const { data: account, error } = await admin.auth.admin.createUser({
      email: greffier.email,
      password: greffier.password,
      email_confirm: true,
    });
    if (error) throw error;
    greffier.id = account.user.id;
    await admin.from("admin_users").insert({ user_id: greffier.id, note: "e2e cutout" });
    const greffe = await (await browser.newContext()).newPage();
    greffier.totpSecret = await openGreffe(greffe, greffier);
    const card = (pose: string) =>
      greffe
        .getByRole("listitem")
        .filter({ has: greffe.locator("p", { hasText: new RegExp(`· ${pose}$`) }) })
        .filter({ hasText: /Toise/ });
    await expect(card("Face").getByTestId("cutout-state")).toHaveText(
      "Détourée, posée sur le mur gradué",
    );
    await expect(card("Profil gauche").getByTestId("cutout-state")).toHaveText(
      "À détourer par le Greffe avant validation",
    );
    await expect(card("Profil gauche").getByRole("button", { name: "Valider" })).toHaveCount(0);
    const before = (await photosOf()).find((p) => p.position === 1)!.pending_path!;
    await card("Profil gauche").getByRole("button", { name: "Détourer" }).click();
    await expect(card("Profil gauche").getByTestId("greffe-cutout")).toHaveAttribute(
      "data-step",
      "ready",
      { timeout: 60_000 },
    );
    await card("Profil gauche").getByRole("button", { name: "Enregistrer le détourage" }).click();
    await expect(card("Profil gauche").getByTestId("cutout-state")).toHaveText(
      "Détourée, posée sur le mur gradué",
      { timeout: 20_000 },
    );
    for (const pose of ["Profil gauche", "Face"]) {
      await card(pose).getByRole("button", { name: "Valider" }).click();
      await expect(card(pose)).toHaveCount(0);
    }
    expect(
      (await photosOf()).map((p) => [p.position, p.status, p.is_cutout, p.needs_cutout]),
    ).toEqual([
      [0, "approved", true, false],
      [1, "approved", true, false],
    ]);
    const { data: leftovers } = await admin.storage.from("photos-pending").list(bad.id);
    expect(leftovers?.map((f) => `${bad.id}/${f.name}`)).not.toContain(before);
    await greffe.context().close();
  });

  test("preview only: the photos validated before the decision, cut out in a batch", async ({
    browser,
  }) => {
    test.skip(!greffier.totpSecret, "needs the first test");
    // Two validated poses as they were before the decision: the original, not cut out.
    const original = await sharp(await readFile("tests/e2e/fixtures/person.jpg"))
      .webp()
      .toBuffer();
    const old: Record<number, string> = {};
    for (const photo of await photosOf()) {
      const name = `e2e-old-${randomBytes(6).toString("hex")}`;
      for (const path of [`${name}.webp`, `${name}-s.webp`]) {
        const { error } = await admin.storage
          .from("photos")
          .upload(path, original, { contentType: "image/webp" });
        if (error) throw error;
      }
      old[photo.position] = `${name}.webp`;
      published.push(
        ...[photo.public_path_large!, photo.public_path_large!.replace(/\.webp$/, "-s.webp")],
      );
      await admin
        .from("photos")
        .update({
          public_path_large: `${name}.webp`,
          public_path_small: `${name}-s.webp`,
          is_cutout: false,
        })
        .eq("id", photo.id);
    }

    const page = await (await browser.newContext()).newPage();
    await openGreffe(page, greffier);
    // Off in the base (as on the production base): the page does not exist.
    const response = await page.goto("/admin/greffe/lot");
    expect(response?.status()).toBe(404);

    await admin.from("app_settings").update({ photo_batch_allowed: true }).eq("id", true);
    await page.goto("/admin/greffe/lot");
    const item = (pose: string) =>
      page
        .getByTestId("batch-item")
        .filter({ has: page.locator("p", { hasText: new RegExp(`^Toise.* · ${pose}$`) }) });
    for (const pose of ["Face", "Profil gauche"]) {
      await expect(item(pose)).toHaveAttribute("data-step", "ready", { timeout: 60_000 });
      await expect(item(pose).getByRole("img", { name: /^Avant/ })).toBeVisible();
      await expect(item(pose).getByRole("img", { name: /^Après/ })).toBeVisible();
    }
    await item("Profil gauche").getByRole("button", { name: "Garder l'ancienne" }).click();
    await expect(item("Profil gauche")).toHaveAttribute("data-step", "kept");
    await page.getByRole("button", { name: /^Tout valider/ }).click();
    await expect(item("Face")).toHaveAttribute("data-step", "done", { timeout: 20_000 });

    const after = await photosOf();
    const faceRow = after.find((p) => p.position === 0)!;
    const leftRow = after.find((p) => p.position === 1)!;
    expect(faceRow.is_cutout).toBe(true);
    expect(faceRow.public_path_large).not.toBe(old[0]);
    expect([leftRow.is_cutout, leftRow.public_path_large]).toEqual([false, old[1]]);
    // The replaced files are gone; the kept ones stay.
    const { data: listed } = await admin.storage
      .from("photos")
      .list("", { limit: 1000, search: "e2e-old-" });
    const names = (listed ?? []).map((file) => file.name);
    expect(names).not.toContain(old[0]);
    expect(names).toContain(old[1]);
    await page.context().close();
  });

  // On demand (E2E_CUTOUT_MEASURE=true, Chromium): a low-end phone simulated. CPU 6× slower (CDP,
  // the page's main thread; the segmentation itself runs in the worker, see docs/PROGRESS.md) and
  // a « slow 4G » network for the cut-out files (1.6 Mbit/s, 150 ms, gzip size: the requests of
  // the worker are delayed by the route, since the CDP network emulation does not reach it).
  // Cold: the step just opened, the runtime still downloading; warm: the runtime loaded.
  test("timing of the cut-out on a low-end phone, simulated", async ({ page, browserName }) => {
    test.skip(
      process.env.E2E_CUTOUT_MEASURE !== "true" || browserName !== "chromium",
      "measure on demand (E2E_CUTOUT_MEASURE=true), Chromium only",
    );
    const person = await readFile("tests/e2e/fixtures/person.jpg");
    await page.goto("/connexion");
    await page.getByLabel("E-mail").fill(bad.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(bad.password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(/onboarding\/5/);

    const timings: string[] = [];
    await page.route(/\/(vendor\/mediapipe|workers)\//, async (route) => {
      const started = Date.now();
      const response = await route.fetch();
      const body = await response.body();
      const transferred = gzipSync(body).length;
      await new Promise((resolve) =>
        setTimeout(resolve, 150 + (transferred * 8) / 1.6e3 / 1.024 / 1.024),
      );
      await route.fulfill({ response, body });
      timings.push(
        `${route.request().url().split("/").pop()}: ${Date.now() - started} ms, ${transferred} B gzip`,
      );
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await page.reload();
    const opened = Date.now();
    const runs: string[] = [];
    for (const label of ["cold", "warm"]) {
      await page
        .getByLabel("Ajouter : Profil droit")
        .setInputFiles({ name: "right.jpg", mimeType: "image/jpeg", buffer: person });
      const result = page.getByTestId("cutout-result");
      await expect(result).not.toHaveAttribute("data-decision", "working", { timeout: 120_000 });
      runs.push(
        `${label}: ${await result.getAttribute("data-decision")} ${(await result.getAttribute("data-reason")) ?? ""} ${await result.getAttribute("data-ms")} ms (${Date.now() - opened} ms after opening the step)`,
      );
      await page
        .getByRole("dialog", { name: "Ta photo sur le mur" })
        .getByRole("button", { name: "Fermer" })
        .click();
      // Let the runtime finish loading before the warm run.
      if (label === "cold")
        await expect.poll(() => timings.length, { timeout: 180_000 }).toBeGreaterThanOrEqual(4);
    }
    console.log(["CPU ×6 (page), slow 4G (cut-out files)", ...runs, ...timings].join("\n"));
  });
});
