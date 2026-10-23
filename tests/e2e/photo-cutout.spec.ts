import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openGreffe } from "./helpers/admin";
import { confirmPhoto, identity, seeking, signUp } from "./helpers/onboarding";

// The photo on the height chart (owner's decision 2026-10-23, version B), LOCAL STACK ONLY: a Bad
// at « Passe à la toise » sends a real portrait (tests/e2e/fixtures/person.jpg, cut from the
// reference image of the project): cut out on the device, previewed, sent with its transparency;
// a second pose kept as it is. The Greffe sees each one as it will be shown.
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
  };

  test.afterAll(async () => {
    for (const id of [bad.id, greffier.id].filter(Boolean)) {
      const { data: files } = await admin.storage.from("photos-pending").list(id);
      if (files?.length)
        await admin.storage.from("photos-pending").remove(files.map((f) => `${id}/${f.name}`));
      await admin.auth.admin.deleteUser(id);
    }
  });

  test("a portrait cut out on the device, a pose kept as it is, the Greffe sees both", async ({
    page,
    browser,
  }) => {
    const person = await readFile("tests/e2e/fixtures/person.jpg");
    await signUp(page, "Je suis Bad", bad, mailpit);
    await identity(page, `Toise${randomBytes(2).toString("hex")}`, "Femme");
    await seeking(page, "Homme", 5);
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
    bad.id = users.users.find((u) => u.email === bad.email)?.id ?? "";

    // Face: cut out on the device, previewed, then sent.
    await page
      .getByLabel("Ajouter : Face · obligatoire")
      .setInputFiles({ name: "face.jpg", mimeType: "image/jpeg", buffer: person });
    const dialog = page.getByRole("dialog", { name: "Ta photo sur le mur" });
    await expect(dialog.getByText(/sur ton appareil/)).toBeVisible();
    const face = await confirmPhoto(page);
    console.log(`cut-out (face): ${face.decision} in ${face.ms} ms`);
    expect(face.decision).toBe("cutout");
    await expect(page.getByRole("img", { name: "Ta photo : Face · obligatoire" })).toBeVisible({
      timeout: 20_000,
    });

    // Left profile: the same portrait, kept as it is by choice.
    await page
      .getByLabel("Ajouter : Profil gauche")
      .setInputFiles({ name: "left.jpg", mimeType: "image/jpeg", buffer: person });
    expect((await confirmPhoto(page, { asIs: true })).decision).toBe("cutout");
    await expect(page.getByRole("img", { name: "Ta photo : Profil gauche" })).toBeVisible({
      timeout: 20_000,
    });

    const { data: photos } = await admin
      .from("photos")
      .select("position, is_cutout, pending_path")
      .eq("owner_id", bad.id)
      .order("position");
    expect(photos?.map((p) => [p.position, p.is_cutout])).toEqual([
      [0, true],
      [1, false],
    ]);
    // What was sent: WebP, transparent around the person, under the bucket limit.
    for (const photo of photos ?? []) {
      const { data: blob } = await admin.storage
        .from("photos-pending")
        .download(photo.pending_path!);
      const bytes = Buffer.from(await blob!.arrayBuffer());
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(bytes.length).toBeLessThanOrEqual(262_144);
    }

    // The Greffe: the face on the wall, the profile with the graduations over it.
    const { data: account, error } = await admin.auth.admin.createUser({
      email: greffier.email,
      password: greffier.password,
      email_confirm: true,
    });
    if (error) throw error;
    greffier.id = account.user.id;
    await admin.from("admin_users").insert({ user_id: greffier.id, note: "e2e cutout" });
    const greffe = await (await browser.newContext()).newPage();
    await openGreffe(greffe, greffier);
    const card = (pose: string) =>
      greffe
        .getByRole("listitem")
        .filter({ has: greffe.locator("p", { hasText: new RegExp(`· ${pose}$`) }) })
        .filter({ has: greffe.getByRole("img", { name: new RegExp(pose) }) });
    await expect(card("Face").getByTestId("cutout-state").first()).toHaveText(
      "Détourée, posée sur le mur gradué",
    );
    await expect(card("Profil gauche").getByTestId("cutout-state").first()).toHaveText(
      "Telle quelle, graduations par-dessus",
    );
    await greffe.context().close();
  });

  // On demand (E2E_CUTOUT_MEASURE=true, Chromium): a low-end phone simulated, CPU 6× slower and
  // a « slow 4G » network (1.6 Mbit/s, 150 ms). Cold: the step just opened, the runtime still
  // downloading; warm: the runtime loaded. The timings go to docs/PROGRESS.md (Phase 9e).
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

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
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
      if (label === "cold") {
        // Let the runtime finish loading before the warm run.
        await expect
          .poll(
            () =>
              page.evaluate(
                () =>
                  performance
                    .getEntriesByType("resource")
                    .filter((entry) => entry.name.includes("/vendor/mediapipe/")).length,
              ),
            { timeout: 180_000 },
          )
          .toBeGreaterThanOrEqual(3);
        await page.waitForTimeout(2_000);
      }
    }
    const resources = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/vendor/mediapipe/"))
        .map((entry) => {
          const timing = entry as PerformanceResourceTiming;
          return `${timing.name.split("/").pop()}: ${Math.round(timing.duration)} ms, ${timing.transferSize} B`;
        }),
    );
    console.log(["CPU ×6, slow 4G", ...runs, ...resources].join("\n"));
  });
});
