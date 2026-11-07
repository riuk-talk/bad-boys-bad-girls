import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { FakePushService } from "./helpers/fake-push-service";
import { captcha } from "./helpers/captcha";

// /api/cron/push end to end, LOCAL STACK ONLY (scripts/ci/local-env.mjs): a member's browser is
// subscribed to a fake push service, a notification is queued by the database (notify(), the
// same function the app uses), and the route is called the way pg_net calls it. The fake service
// checks the VAPID signature and decrypts the message; the real service worker then shows it.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const cronSecret = process.env.PUSH_CRON_SECRET ?? "";
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
const vapidSubject = process.env.VAPID_SUBJECT ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  [publishable, secret, cronSecret, vapidPublicKey, siteUrl, vapidSubject].every(
    (value) => value !== "",
  ) &&
  Boolean(process.env.PUSH_TEST_TLS_CERT);

// The neutral texts, read from the service worker itself (the source of truth).
function serviceWorkerTexts(): Record<string, Record<string, [string, string]>> {
  const source = readFileSync("public/sw.js", "utf8");
  const match = /\/\* TEXTS \*\/ (\{[\s\S]*?\}) \/\* \/TEXTS \*\//.exec(source);
  if (!match?.[1]) throw new Error("TEXTS block not found in public/sw.js");
  return JSON.parse(match[1]);
}

test.describe("Web Push: /api/cron/push against a fake push service (local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  // CDP delivers the push to the service worker: Chromium only, once.
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium only (CDP)");
  test.describe.configure({ mode: "serial" });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const push = new FakePushService();
  const sender = { pseudo: `Nox${randomBytes(2).toString("hex")}`, note: "Rendez-vous au phare" };
  let userId = "";
  let endpoint = "";
  let plaintext = "";

  const callRoute = (request: import("@playwright/test").APIRequestContext, auth?: string) =>
    request.post("/api/cron/push", {
      data: {},
      headers: auth ? { authorization: auth } : {},
    });

  async function queue(type: "request_received" | "request_accepted") {
    const { error } = await admin.rpc("notify", {
      p_user: userId,
      p_type: type,
      p_payload: { request_id: randomUUID(), pseudo: sender.pseudo, note: sender.note },
    });
    if (error) throw error;
  }

  async function outbox() {
    const { data, error } = await admin
      .from("push_outbox")
      .select("type, status, payload")
      .eq("user_id", userId)
      .order("id");
    if (error) throw error;
    return data;
  }

  test.beforeAll(async () => {
    await push.start();
    const email = `e2e-push-${randomBytes(4).toString("hex")}@example.com`;
    const password = `Pw-${randomBytes(12).toString("base64url")}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    const profile = await admin.from("profiles").insert({
      id: userId,
      pseudo: `Lune${randomBytes(2).toString("hex")}`,
      birthdate: "1996-03-02",
      gender: "woman",
      seeking_genders: ["man"],
      role: "bad",
    });
    if (profile.error) throw profile.error;

    // The member subscribes this "browser", through the same function as the app.
    const member = createClient(url, publishable, { auth: { persistSession: false } });
    const signedIn = await member.auth.signInWithPassword({ email, password, options: captcha });
    if (signedIn.error) throw signedIn.error;
    const browser = push.newBrowser();
    endpoint = browser.endpoint;
    const saved = await member.rpc("save_push_subscription", {
      p_endpoint: browser.endpoint,
      p_p256dh: browser.p256dh,
      p_auth: browser.auth,
      p_locale: "fr",
    });
    if (saved.error) throw saved.error;
  });

  test.afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
    await push.stop();
  });

  test("401 without the secret or with a wrong one, and nothing is sent", async ({ request }) => {
    await queue("request_received");
    expect((await callRoute(request)).status()).toBe(401);
    expect(
      (await callRoute(request, `Bearer ${randomBytes(32).toString("base64url")}`)).status(),
    ).toBe(401);
    expect((await callRoute(request, cronSecret)).status(), "secret without Bearer").toBe(401);
    expect(push.received).toHaveLength(0);
    expect((await outbox()).map((row) => row.status)).toEqual(["queued"]);
  });

  test("200 with the secret: signed (VAPID), encrypted, and the message is a type and a path", async ({
    request,
  }) => {
    const response = await callRoute(request, `Bearer ${cronSecret}`);
    expect(response.status()).toBe(200);
    expect((await response.json()).sent).toBeGreaterThanOrEqual(1);

    expect(push.received).toHaveLength(1);
    const received = push.received[0]!;
    expect(received.plaintext).not.toMatch(/^ERROR/);
    expect(`${push.url}${received.path}`).toBe(endpoint);
    expect(received.headers["content-encoding"]).toBe("aes128gcm");
    expect(received.headers.ttl).toBe(String(24 * 3600));
    expect(received.headers.urgency).toBe("normal");
    expect(received.headers.topic).toBe("request_received");

    // VAPID: our key, addressed to this push service, with the configured contact.
    expect(received.vapid.publicKey).toBe(vapidPublicKey);
    expect(received.vapid.audience).toBe(push.url);
    expect(received.vapid.subject).toBe(vapidSubject);
    const now = Date.now() / 1000;
    expect(received.vapid.expiresAt).toBeGreaterThan(now);
    expect(received.vapid.expiresAt).toBeLessThanOrEqual(now + 24 * 3600);

    // The decrypted message: the type and an internal path, nothing from the notification.
    plaintext = received.plaintext;
    expect(JSON.parse(plaintext)).toEqual({ t: "request_received", u: "/courrier" });
    expect(plaintext).not.toContain(sender.pseudo);
    expect(plaintext).not.toContain(sender.note);

    expect((await outbox()).map((row) => row.status)).toEqual(["sent"]);
  });

  test("the service worker shows the neutral text, under the site's own origin", async ({
    browser,
  }) => {
    const context = await browser.newContext({ permissions: ["notifications"] });
    const page = await context.newPage();
    await page.goto("/charte");
    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      return registration.scope;
    });
    const origin = new URL(siteUrl).origin;
    expect(new URL(scope).origin, "the phone shows this domain above the notification").toBe(
      origin,
    );

    const cdp = await context.newCDPSession(page);
    const registrationId = new Promise<string>((resolve) => {
      cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
        const found = registrations.find((r) => r.scopeURL === scope && !r.isDeleted);
        if (found) resolve(found.registrationId);
      });
    });
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin,
      registrationId: await registrationId,
      data: plaintext,
    });

    const texts = serviceWorkerTexts().fr?.request_received;
    if (!texts) throw new Error("no French text for request_received in public/sw.js");
    const [title, body] = texts;
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.ready;
          return (await registration.getNotifications()).map((n) => ({
            title: n.title,
            body: n.body,
            url: (n.data as { url?: string } | null)?.url,
          }));
        }),
      )
      .toEqual([{ title, body, url: "/courrier" }]);
    const shown = `${title} ${body}`;
    expect(shown).not.toContain(sender.pseudo);
    expect(shown).not.toContain(sender.note);
    await context.close();
  });

  test("a browser the push service says is gone (410) is revoked", async ({ request }) => {
    push.status = 410;
    await queue("request_accepted");
    expect((await callRoute(request, `Bearer ${cronSecret}`)).status()).toBe(200);
    expect(push.received).toHaveLength(2);
    const { data, error } = await admin
      .from("push_subscriptions")
      .select("revoked_at, endpoint")
      .eq("user_id", userId);
    if (error) throw error;
    expect(data).toEqual([{ revoked_at: expect.any(String), endpoint: null }]);
  });
});
