import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

// /api/cron/email end to end, LOCAL STACK ONLY (scripts/ci/local-env.mjs): an e-mail is queued
// by the database, the route is called the way pg_net calls it, and a fake Resend service on
// 127.0.0.1:3199 receives what Resend would. Nothing ever leaves for Resend. Then the one-click
// unsubscribe of the e-mail.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const cronSecret = process.env.PUSH_CRON_SECRET ?? "";
const resendUrl = process.env.RESEND_API_URL ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  [secret, cronSecret, process.env.RESEND_API_KEY ?? ""].every((value) => value !== "") &&
  resendUrl === "http://127.0.0.1:3199/emails";

type Sent = {
  authorization: string | undefined;
  idempotencyKey: string | undefined;
  userAgent: string | undefined;
  body: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
    headers?: Record<string, string>;
  };
};

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk: Buffer) => (data += chunk.toString("utf8")));
    request.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
  });
}

test.describe("E-mails: /api/cron/email against a fake Resend service (local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  test.skip(({ browserName }) => browserName !== "chromium", "once is enough");
  test.describe.configure({ mode: "serial" });

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const email = `mail-${randomBytes(4).toString("hex")}@test.local`;
  const pseudo = `Mail${randomBytes(3).toString("hex")}`;
  const received: Sent[] = [];
  let server: Server | undefined;
  let userId = "";

  test.beforeAll(async () => {
    server = createServer(async (request, response) => {
      if (request.method === "POST" && request.url === "/emails") {
        received.push({
          authorization: request.headers.authorization,
          idempotencyKey: request.headers["idempotency-key"] as string | undefined,
          userAgent: request.headers["user-agent"],
          body: (await readJson(request)) as Sent["body"],
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server!.listen(3199, "127.0.0.1", resolve));
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw error ?? new Error("no user");
    userId = data.user.id;
    const insert = await admin.from("profiles").insert({ id: userId, pseudo });
    if (insert.error) throw insert.error;
    const queued = await admin
      .from("email_outbox")
      .insert({ user_id: userId, kind: "zone_opened", priority: 1 });
    if (queued.error) throw queued.error;
  });

  test.afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
    // On WebKit every test is skipped: beforeAll did not run, there is no server to close.
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  test("refuses a call without the secret", async ({ request }) => {
    const response = await request.post("/api/cron/email", { data: {} });
    expect(response.status()).toBe(401);
  });

  test("sends the queued e-mail through Resend, neutral, with a one-click unsubscribe", async ({
    request,
  }) => {
    const response = await request.post("/api/cron/email", {
      data: {},
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    expect(response.status()).toBe(200);
    const mine = received.find((sent) => sent.body.to[0] === email);
    expect(mine, "the fake Resend service received the e-mail").toBeDefined();
    expect(mine?.authorization).toBe(`Bearer ${process.env.RESEND_API_KEY}`);
    expect(mine?.body.from).toBe(`"Bad Boys & Bad Girls" <${process.env.EMAIL_FROM}>`);
    expect(mine?.body.to).toEqual([email]);
    expect(mine?.userAgent).toBeTruthy();
    expect(mine?.idempotencyKey).toMatch(/^email-outbox-\d+$/);
    expect(mine?.body.subject).toBe("Ton quartier ouvre aux visites");
    expect(mine?.body.text).not.toContain(pseudo);
    expect(mine?.body.html).not.toContain(pseudo);
    const { data: row } = await admin
      .from("email_outbox")
      .select("status")
      .eq("user_id", userId)
      .eq("kind", "zone_opened")
      .single();
    expect(row?.status).toBe("sent");

    const oneClick = /<([^>]+)>/.exec(mine?.body.headers?.["List-Unsubscribe"] ?? "")?.[1] ?? "";
    expect(oneClick).toContain("/api/email/unsubscribe?t=");
    const unsubscribed = await request.post(new URL(oneClick).pathname + new URL(oneClick).search);
    expect(unsubscribed.status()).toBe(200);
    const { data: prefs } = await admin
      .from("notification_preferences")
      .select("email_zone_opened, email_date_accepted")
      .eq("user_id", userId)
      .single();
    expect(prefs).toEqual({ email_zone_opened: false, email_date_accepted: true });
  });

  test("a link opened (or prefetched) changes nothing: the page asks first", async ({ page }) => {
    const { data: prefs } = await admin
      .from("notification_preferences")
      .select("unsubscribe_token")
      .eq("user_id", userId)
      .single();
    await page.goto(`/api/email/unsubscribe?t=${prefs?.unsubscribe_token}&k=date_accepted`);
    await expect(page.getByRole("button", { name: "Me désinscrire" })).toBeVisible();
    const { data: still } = await admin
      .from("notification_preferences")
      .select("email_date_accepted")
      .eq("user_id", userId)
      .single();
    expect(still?.email_date_accepted).toBe(true);
    await page.getByRole("button", { name: "Me désinscrire" }).click();
    await expect(page.getByText("C'est fait")).toBeVisible();
  });
});
