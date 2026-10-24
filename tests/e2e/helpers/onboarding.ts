import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// A real sign-up and a real onboarding, through the screens (Phase 8d, end-to-end journey). The
// same steps as signup.spec.ts and onboarding-complete.spec.ts, without their extra checks.

type MailpitSearch = { messages: { ID: string }[] };
type MailpitMessage = { Text: string };

/** The confirmation link of the last e-mail sent to `to` (Mailpit, the mailbox of the local stack). */
async function confirmationLink(mailpit: string, to: string): Promise<string> {
  let id = "";
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
        );
        id = ((await response.json()) as MailpitSearch).messages[0]?.ID ?? "";
        return id;
      },
      { message: `confirmation e-mail for ${to}`, timeout: 20_000 },
    )
    .not.toBe("");
  const message = (await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()) as MailpitMessage;
  const link = /https?:\/\/\S+\/auth\/v1\/verify\?\S+/.exec(message.Text)?.[0];
  if (!link) throw new Error("no confirmation link in the e-mail");
  return link;
}

/**
 * From the landing door (or a referral link) to the first onboarding step, through the
 * confirmation e-mail.
 */
export async function signUp(
  page: Page,
  door: "Je suis Bad" | "Je viens visiter",
  account: { email: string; password: string },
  mailpit: string,
  referral?: string,
) {
  if (referral) {
    const role = door === "Je suis Bad" ? "bad" : "visitor";
    await page.goto(`/inscription?role=${role}&parrain=${referral}`);
  } else {
    await page.goto("/");
    await page
      .getByRole("link", { name: new RegExp(door) })
      .first()
      .click();
  }
  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByRole("heading", { name: "Vérifie ta boîte mail" })).toBeVisible();
  // The link opened in the same browser (PKCE: the code verifier is here).
  await page.goto(await confirmationLink(mailpit, account.email));
  await page.waitForURL(/onboarding\/1/, { waitUntil: "commit" });
}

/** A real portrait (cut from the reference image of the project): the device cuts it out. */
export function portrait() {
  return readFile("tests/e2e/fixtures/person.jpg");
}

/**
 * Waits until the photo page knows where the cut-out will run (worker, page, or none): a page
 * reached by a link may load itself again once first (components/onboarding/cutout-choice.tsx).
 */
export async function cutoutReady(page: Page) {
  await expect(page.locator("[data-cutout-engine]").first()).toBeAttached({ timeout: 20_000 });
  await expect(page.locator('[data-cutout-engine="loading"]')).toHaveCount(0, { timeout: 20_000 });
}

/**
 * The preview of a chosen photo (owner's final decision 2026-10-23): waits for the cut-out made on
 * the device, then « Déposer au Greffe ». Returns what the device decided ("cutout", or "as_is"
 * when the original goes to the Greffe for its cut-out) with the time it took.
 */
export async function confirmPhoto(page: Page) {
  const result = page.getByTestId("cutout-result");
  await expect(result).not.toHaveAttribute("data-decision", "working", { timeout: 60_000 });
  const decision = (await result.getAttribute("data-decision")) ?? "";
  const ms = Number(await result.getAttribute("data-ms"));
  const reason = await result.getAttribute("data-reason");
  // Where the cut-out ran (worker or page) and why not in the worker: printed for the CI logs.
  const detail = (await result.getAttribute("data-detail")) ?? "";
  console.log(`cut-out: ${decision} ${reason ?? ""} ${ms} ms · ${detail}`);
  const dialog = page.getByRole("dialog", { name: "Ta photo sur le mur" });
  await dialog.getByRole("button", { name: "Déposer au Greffe" }).click();
  await expect(dialog).toBeHidden();
  return { decision, reason, ms, detail };
}

async function next(page: Page, step: number, button = "Continuer") {
  await page.getByRole("button", { name: button }).click();
  await page.waitForURL(new RegExp(`onboarding/${step}`), { waitUntil: "commit" });
}

/** Steps 1 (age, rules) and 2 (identity in Toulon), then the role (preselected by the door). */
export async function identity(page: Page, pseudo: string, gender: "Femme" | "Homme") {
  await page.getByLabel("Date de naissance").fill("1990-04-21");
  await page.getByLabel("J'atteste avoir 18 ans ou plus.").check();
  await page.locator("#terms").check();
  await page.locator("#privacy").check();
  await next(page, 2);
  await page.getByLabel("Pseudo").fill(pseudo);
  await page.getByLabel(gender, { exact: true }).check();
  await page.getByRole("combobox").fill("toulon");
  await page.getByRole("option", { name: /^Toulon\s*83000$/ }).click();
  await next(page, 3);
  await next(page, 4);
}

export async function seeking(page: Page, gender: "Femme" | "Homme", step: number) {
  await page.getByLabel(gender, { exact: true }).check();
  await page.getByLabel("Âge minimum").fill("25");
  await page.getByLabel("Âge maximum").fill("45");
  await page.locator("#consent").check();
  await next(page, step);
}

/** Step 8: the first answer to each of the 10 core questions. */
async function interrogation(page: Page, finish: string) {
  for (let index = 1; index <= 10; index += 1) {
    await expect(page.getByText(`Interrogatoire · ${index}/10`)).toBeVisible();
    await page.getByRole("radio").first().check({ force: true });
    await page.getByRole("button", { name: index === 10 ? finish : "Question suivante" }).click();
    if (index < 10)
      await page.waitForURL(new RegExp(`onboarding/8\\?q=${index + 1}`), { waitUntil: "commit" });
  }
  await page.waitForURL(/quartier|ma-fiche/, { waitUntil: "commit" });
}

/** The Dossier of a Bad (a woman seeking men): 3 poses, the Casier (the true line first). */
export async function onboardBad(page: Page, pseudo: string, charges: readonly string[]) {
  await identity(page, pseudo, "Femme");
  await seeking(page, "Homme", 5);
  // The framing guide: where the placard of the Fiche will stand, and the rule of the Greffe.
  await expect(page.getByText("Visage et épaules dans le cadre", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: /^Visage et épaules dans le cadre :/ }),
  ).toBeVisible();
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/bad-toise.png`, fullPage: true });
  for (const pose of ["Profil gauche", "Face · obligatoire", "Profil droit"]) {
    await cutoutReady(page);
    await page
      .getByLabel(`Ajouter : ${pose}`)
      .setInputFiles({ name: "pose.jpg", mimeType: "image/jpeg", buffer: await portrait() });
    if (process.env.E2E_SCREENSHOTS && pose === "Profil gauche") {
      await expect(page.getByTestId("cutout-result")).not.toHaveAttribute(
        "data-decision",
        "working",
        { timeout: 60_000 },
      );
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/bad-toise-apercu.png` });
    }
    // Cut out on the device by MODNet (9i), in the worker, on Pixel 7 and iPhone 14 alike.
    expect(await confirmPhoto(page)).toMatchObject({ decision: "cutout", detail: "modnet" });
    await expect(page.getByRole("img", { name: `Ta photo : ${pose}` })).toBeVisible({
      timeout: 20_000,
    });
  }
  await next(page, 6, "Déposer au Greffe");
  // A cliché is advised against (SPEC §6 [P1]), with a prompt, without blocking.
  const advice = page.getByText("Ça, tout le monde peut l'écrire. Donne un vrai fait.");
  await page.getByLabel("Chef d'accusation n° 1 · Le vrai").fill("Coupable de vol de cœurs");
  await expect(advice).toBeVisible();
  await expect(page.getByText(/Par exemple : « .+ »/)).toBeVisible();
  await page.getByLabel("Chef d'accusation n° 1 · Le vrai").fill(charges[0]!);
  await expect(advice).toBeHidden();
  await page.getByRole("button", { name: "Suivant : le premier faux" }).click();
  await page.getByLabel("Chef d'accusation n° 2 · Un faux").fill(charges[1]!);
  await page.getByRole("button", { name: "Suivant : le second faux" }).click();
  await page.getByLabel("Chef d'accusation n° 3 · Un faux").fill(charges[2]!);
  await next(page, 7, "Voir mon Casier");
  await next(page, 8, "Mon Casier est prêt");
  await interrogation(page, "Terminer mon Dossier");
}

/** The Permis of a Visitor (a man seeking women): « Entraîne-toi », a photo, the Motif. */
export async function onboardVisitor(page: Page, pseudo: string, motive: string) {
  await identity(page, pseudo, "Homme");
  await page.getByRole("button", { name: /traversé l'Espagne/ }).click();
  await next(page, 5, "J'ai compris, je prends mon Permis");
  await seeking(page, "Femme", 6);
  await cutoutReady(page);
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "moi.jpg", mimeType: "image/jpeg", buffer: await portrait() });
  // « Déposer au Greffe » sends the photo and moves on.
  expect((await confirmPhoto(page)).decision).toBe("cutout");
  await page.waitForURL(/onboarding\/7/, { waitUntil: "commit" });
  await page.getByLabel("Motif de visite").fill(motive);
  await next(page, 8);
  await interrogation(page, "Terminer mon Permis");
}
