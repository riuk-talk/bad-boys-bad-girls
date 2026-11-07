import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { captcha } from "./helpers/captcha";

// The Realtime channel of « … écrit » (9l), LOCAL STACK ONLY, against the real Realtime server:
// only the two members of the conversation join its private channel; a stranger and an
// anonymous visitor are refused. While the project allows public channels (the local stack
// does: _realtime.tenants.private_only = false), anyone may also join a PUBLIC channel with the
// same name: this test proves that it is a separate channel, so nothing passes between the two
// in either direction (no « … écrit » read by an outsider, none injected into the members').
// A public listener next to it is the control that public delivery itself works. If the project
// becomes « private only », the public join is refused instead, and the test says so.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const dbUrl = process.env.SUPABASE_DB_URL ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  [publishable, secret, dbUrl].every((value) => value !== "");

function asOwner(sql: string): string {
  return execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")[0]!;
}

type Joined = { status: string; got: unknown[]; send: (payload: object) => Promise<unknown> };

/** Joins `topic` (private or public) and records the « typing » signals it receives. */
function join(client: SupabaseClient, topic: string, isPrivate: boolean): Promise<Joined> {
  return new Promise((resolve) => {
    const got: unknown[] = [];
    const channel = client.channel(topic, {
      config: { private: isPrivate, broadcast: { self: false } },
    });
    channel.on("broadcast", { event: "typing" }, (message) => got.push(message.payload));
    const done = (status: string) =>
      resolve({
        status,
        got,
        send: (payload) => channel.send({ type: "broadcast", event: "typing", payload }),
      });
    const timer = setTimeout(() => done("TIMEOUT"), 10_000);
    channel.subscribe((status) => {
      if (status === "CLOSED") return;
      clearTimeout(timer);
      done(status);
    });
  });
}

test.describe("Realtime: the « … écrit » channel, members only (local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");
  // No browser involved: run once, on the Chromium project.
  test.skip(({ browserName }) => browserName !== "chromium", "once, no browser needed");

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const accounts: string[] = [];
  const clients: SupabaseClient[] = [];

  test.afterAll(async () => {
    for (const client of clients) await client.removeAllChannels();
    for (const id of accounts) await admin.auth.admin.deleteUser(id);
  });

  /** A signed-in session (a new client: one channel per topic and per client). */
  async function session(email: string, password: string) {
    const client = createClient(url, publishable, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email, password, options: captcha });
    if (error) throw error;
    await client.realtime.setAuth();
    clients.push(client);
    return client;
  }

  async function member(role: "bad" | "visitor") {
    const email = `e2e-rt-${randomUUID().slice(0, 8)}@example.com`;
    const password = `Pw-${randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    const id = data.user.id;
    accounts.push(id);
    const place = asOwner(
      `insert into public.places (official_code, name, lat, lng)
       values ('RT${id.slice(0, 8)}', 'Ville test', 47.5, 3.5) returning id`,
    );
    asOwner(
      `insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, place_id, role, visit_motive)
       values ('${id}', 'rt${id.replace(/[^a-f]/g, "").slice(0, 10)}', '1990-01-01', 'woman', '{man,woman}',
               ${place}, '${role}', ${role === "visitor" ? "'Motif de test'" : "null"})`,
    );
    return { id, email, password };
  }

  test("only the two members join it; a public channel of the same name is separate", async () => {
    const bad = await member("bad");
    const visitor = await member("visitor");
    const stranger = await member("visitor");
    const conversation = asOwner(
      `insert into public.conversations (bad_id, visitor_id, status, released_at)
       values ('${bad.id}', '${visitor.id}', 'open', now()) returning id`,
    );
    const topic = `parloir-typing:${conversation}`;

    // The private channel: the two members only (RLS on realtime.messages).
    const badPrivate = await join(await session(bad.email, bad.password), topic, true);
    const visitorPrivate = await join(await session(visitor.email, visitor.password), topic, true);
    expect([badPrivate.status, visitorPrivate.status]).toEqual(["SUBSCRIBED", "SUBSCRIBED"]);
    const strangerPrivate = await join(
      await session(stranger.email, stranger.password),
      topic,
      true,
    );
    expect(strangerPrivate.status).toBe("CHANNEL_ERROR");
    const anonymous = () => {
      const client = createClient(url, publishable, { auth: { persistSession: false } });
      clients.push(client);
      return client;
    };
    expect((await join(anonymous(), topic, true)).status).toBe("CHANNEL_ERROR");

    // The same name, as a public channel (no « private: true »).
    const strangerPublic = await join(
      await session(stranger.email, stranger.password),
      topic,
      false,
    );
    const anonPublic = await join(anonymous(), topic, false);
    const control = await join(anonymous(), topic, false);
    const publicAllowed = strangerPublic.status === "SUBSCRIBED";
    test.info().annotations.push({
      type: "realtime",
      description: publicAllowed
        ? "public channels allowed: the public channel of the same name is joinable, and separate"
        : "private only: the public join is refused",
    });
    if (!publicAllowed) {
      expect([strangerPublic.status, anonPublic.status]).not.toContain("SUBSCRIBED");
    }

    await visitorPrivate.send({ from: "visitor-private" });
    if (publicAllowed) {
      await strangerPublic.send({ from: "stranger-public" });
      await anonPublic.send({ from: "anon-public" });
    }
    // The member receives the other member's signal: the private channel works.
    await expect.poll(() => badPrivate.got).toEqual([{ from: "visitor-private" }]);
    if (publicAllowed) {
      // Public delivery works (the control hears both public senders)…
      await expect
        .poll(() => control.got)
        .toEqual(expect.arrayContaining([{ from: "stranger-public" }, { from: "anon-public" }]));
    }
    // …and still nothing crossed: no outsider heard the members, no outsider reached them.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(badPrivate.got).toEqual([{ from: "visitor-private" }]);
    expect(strangerPrivate.got).toEqual([]);
    expect(strangerPublic.got).not.toContainEqual({ from: "visitor-private" });
    expect(anonPublic.got).not.toContainEqual({ from: "visitor-private" });
    expect(control.got).not.toContainEqual({ from: "visitor-private" });
  });
});
