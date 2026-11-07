import { expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

/** RFC 4648 base32 (the TOTP key shown by Supabase Auth). */
function base32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("not a base32 key");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => parseInt(byte, 2)));
}

/** RFC 6238 TOTP: SHA-1, 30-second steps, 6 digits (what an authenticator app shows). */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/** A fresh code, never one about to expire (the step changes every 30 s). */
async function freshCode(secret: string): Promise<string> {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 4_000) await new Promise((resolve) => setTimeout(resolve, left + 500));
  return totp(secret);
}

/**
 * An admin opens /admin/greffe: sign-in, then the second factor (Phase 5a-ter). The first time,
 * the page shows the key to enrol; it is returned so later sessions can type a code from it.
 */
export async function openGreffe(
  page: Page,
  account: { email: string; password: string; totpSecret?: string },
): Promise<string> {
  await page.goto("/connexion");
  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  // The login goes to /onboarding, which redirects once or twice more (an admin: the first
  // onboarding step; the super admin: /admin, then /acces-admin). Wait for the final page, or the
  // next navigation is interrupted (WebKit).
  await page.waitForURL((url) => /^\/(onboarding\/\d+|acces-admin)$/.test(url.pathname));
  if (!page.url().includes("/acces-admin")) {
    await page.goto("/admin/greffe");
    await page.waitForURL(/\/acces-admin/);
  }
  await expect(page.getByRole("heading", { name: "Double authentification" })).toBeVisible();
  let secret = account.totpSecret;
  if (!secret) {
    const shown = page.getByTestId("totp-secret");
    await expect(shown).toBeVisible();
    secret = (await shown.textContent())?.trim() ?? "";
    await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  }
  await page.getByLabel("Code à 6 chiffres").fill(await freshCode(secret));
  await page.getByRole("button", { name: "Vérifier" }).click();
  await page.waitForURL(/\/admin\/greffe/);
  await expect(page.getByRole("heading", { name: "Le Greffe" })).toBeVisible();
  return secret;
}

/**
 * Follows an entry of the admin menu (10c): in the side menu from lg up, in the « Menu admin »
 * drawer on a phone.
 */
export async function adminMenu(page: Page, name: string | RegExp): Promise<void> {
  const button = page.getByRole("button", { name: "Menu admin" });
  if (await button.isVisible()) {
    await button.click();
    await page.getByRole("dialog", { name: "Menu admin" }).getByRole("link", { name }).click();
    return;
  }
  await page
    .getByRole("navigation", { name: "Administration" })
    .getByRole("link", { name })
    .click();
}
