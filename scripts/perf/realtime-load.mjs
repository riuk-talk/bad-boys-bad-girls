// Phase 8b: Realtime load of an evening at 21:00 (SPEC §18), LOCAL STACK ONLY.
// N visits at once (default 100): 2·N members signed in, each subscribed to the messages of its
// Parloir exactly as components/parloir/chat.tsx does (postgres_changes, RLS checked per member),
// then every member sends a message every few seconds. Prints the delivery delay (p50, p95, max)
// and the messages lost. Everything created is erased at the end.
// Usage: node scripts/perf/realtime-load.mjs [visits] [seconds]   (env of scripts/ci/local-env.mjs)
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const [visits = 100, seconds = 60] = process.argv.slice(2).map(Number);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const dbUrl = process.env.SUPABASE_DB_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url) || !/@(127\.0\.0\.1|localhost):/.test(dbUrl)) {
  throw new Error("local stack only (scripts/ci/local-env.mjs)");
}
const SEND_EVERY_MS = 5_000;
const JOIN_BATCH = 20;

const sql = (query) =>
  execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", query], {
    encoding: "utf8",
  }).trim();
const admin = createClient(url, secret, { auth: { persistSession: false } });
const tag = randomBytes(3).toString("hex");
const password = `Pw-${randomBytes(12).toString("base64url")}`;
const members = [];

async function createMembers() {
  for (let i = 0; i < visits * 2; i++) {
    const email = `perf-rt-${tag}-${i}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    members.push({ email, id: data.user.id, role: i % 2 === 0 ? "bad" : "visitor" });
  }
  const place = sql(
    `insert into public.places (official_code, name, lat, lng) values ('RT${tag}', 'Perf temps réel', 47.5, 3.5) returning id`,
  );
  const rows = members
    .map(
      (m, i) =>
        `('${m.id}', 'rt${tag}${String.fromCharCode(97 + (i % 26))}${i}', date '1990-01-01', '${i % 4 < 2 ? "man" : "woman"}', '{man,woman}', ${place}, '${m.role}', ${m.role === "visitor" ? "'Motif de test'" : "null"})`,
    )
    .join(",");
  sql(
    `insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, place_id, role, visit_motive) values ${rows}`,
  );
  const pairs = [];
  for (let i = 0; i < visits; i++)
    pairs.push(`('${members[2 * i].id}', '${members[2 * i + 1].id}')`);
  const ids = sql(
    `insert into public.conversations (bad_id, visitor_id) values ${pairs.join(",")} returning id`,
  ).split("\n");
  ids.forEach((id, i) => {
    members[2 * i].conversation = id;
    members[2 * i + 1].conversation = id;
  });
  return place;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;
}

let place = "";
const clients = [];
try {
  const t0 = Date.now();
  place = await createMembers();
  console.log(
    `${visits} visits, ${members.length} members created in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );

  const delays = [];
  let received = 0;
  const joinStart = Date.now();
  // In batches, as members arrive over minutes, not in the same millisecond (the free plan also
  // caps channel joins at 100 per second).
  const join = async (m) => {
    const client = createClient(url, publishable, { auth: { persistSession: false } });
    clients.push(client);
    const { data, error } = await client.auth.signInWithPassword({ email: m.email, password });
    if (error) throw error;
    client.realtime.setAuth(data.session.access_token);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no SUBSCRIBED for ${m.email}`)), 60_000);
      client
        .channel(`parloir:${m.conversation}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${m.conversation}`,
          },
          (payload) => {
            received += 1;
            delays.push(Date.now() - Number(payload.new.body));
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timer);
            resolve();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(timer);
            reject(new Error(`${status} for ${m.email}`));
          }
        });
    });
  };
  for (let i = 0; i < members.length; i += JOIN_BATCH) {
    await Promise.all(members.slice(i, i + JOIN_BATCH).map(join));
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(
    `${members.length} subscriptions in ${((Date.now() - joinStart) / 1000).toFixed(1)} s`,
  );

  // Every member sends a message every SEND_EVERY_MS (spread over the period): the body carries
  // the sending time, so the delay is measured on the receiving side.
  let sent = 0;
  const stopAt = Date.now() + seconds * 1000;
  const per = members.length / (SEND_EVERY_MS / 1000);
  while (Date.now() < stopAt) {
    const tick = Date.now();
    const batch = [];
    for (let k = 0; k < per; k++) {
      const m = members[(sent + k) % members.length];
      batch.push(`('${m.conversation}', '${m.id}', 'text', '${Date.now()}')`);
    }
    sql(
      `insert into public.messages (conversation_id, sender_id, kind, body) values ${batch.join(",")}`,
    );
    sent += batch.length;
    await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - tick))));
  }
  await new Promise((r) => setTimeout(r, 10_000));
  const expected = sent * 2;
  console.log(
    `messages sent ${sent} (${(sent / seconds).toFixed(0)}/s), deliveries ${received}/${expected} (lost ${expected - received})`,
  );
  console.log(
    `delay p50 ${percentile(delays, 50)} ms, p95 ${percentile(delays, 95)} ms, max ${Math.max(...delays)} ms`,
  );
} finally {
  await Promise.all(clients.map((c) => c.removeAllChannels()));
  const conversations = [...new Set(members.map((m) => m.conversation).filter(Boolean))];
  if (conversations.length > 0) {
    sql(
      `delete from public.conversations where id in (${conversations.map((id) => `'${id}'`).join(",")})`,
    );
  }
  for (const m of members) await admin.auth.admin.deleteUser(m.id);
  if (place) sql(`delete from public.places where id = ${place}`);
}
