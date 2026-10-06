// Environment for CI and local end-to-end runs against the LOCAL Supabase stack (`supabase start`).
// Never touches a remote project: it refuses to run unless the stack answers on 127.0.0.1.
// Everything secret is generated here, for this run only (VAPID keys, push route secret, a
// throwaway TLS certificate for the fake push service). Nothing is printed.
//
//   node scripts/ci/local-env.mjs <output file>
//
// The output is KEY=value lines: $GITHUB_ENV in CI, `.env.ci.local` locally (ignored by git).
// In GitHub Actions the generated values are also masked in the logs.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import webpush from "web-push";

const output = process.argv[2];
if (!output) {
  console.error("usage: node scripts/ci/local-env.mjs <output file>");
  process.exit(2);
}

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);
const apiUrl = new URL(status.API_URL);
if (apiUrl.hostname !== "127.0.0.1" && apiUrl.hostname !== "localhost") {
  console.error("Refused: the Supabase stack is not local.");
  process.exit(1);
}

const port = process.env.PORT ?? "3100";
const siteUrl = `http://localhost:${port}`;
const vapid = webpush.generateVAPIDKeys();
const pushSecret = randomBytes(32).toString("base64url");

// Throwaway certificate for the fake push service (web-push only speaks HTTPS). The Next.js
// server trusts it through NODE_EXTRA_CA_CERTS; it is valid for one day and never leaves the run.
const dir = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), "push-tls-"));
mkdirSync(dir, { recursive: true });
const cert = join(dir, "cert.pem");
const key = join(dir, "key.pem");
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-keyout",
    key,
    "-out",
    cert,
  ],
  { stdio: "ignore" },
);

const values = {
  NEXT_PUBLIC_SITE_URL: siteUrl,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY,
  SUPABASE_DB_URL: status.DB_URL,
  MAILPIT_URL: status.MAILPIT_URL,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  // web-push accepts only https: or mailto: (production: the https URL of the site).
  VAPID_SUBJECT: `https://localhost:${port}`,
  PUSH_CRON_SECRET: pushSecret,
  PUSH_TEST_TLS_CERT: cert,
  PUSH_TEST_TLS_KEY: key,
  NODE_EXTRA_CA_CERTS: cert,
  APP_ENV: "development",
  SIGNUPS_OPEN: "true",
  E2E_ALLOW_WRITE: "true",
  E2E_LOCAL_STACK: "true",
};

const masked = ["SUPABASE_SECRET_KEY", "VAPID_PRIVATE_KEY", "PUSH_CRON_SECRET"];
if (process.env.GITHUB_ACTIONS === "true") {
  for (const name of masked) process.stdout.write(`::add-mask::${values[name]}\n`);
}
appendFileSync(
  output,
  Object.entries(values)
    .map(([name, value]) => `${name}=${value}\n`)
    .join(""),
  { mode: 0o600 },
);
console.log(`Local environment written (${Object.keys(values).length} variables).`);
