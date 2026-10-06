import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify,
  type ECDH,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";

/**
 * A local stand-in for a browser push service (FCM, Mozilla autopush, Apple): it receives what
 * /api/cron/push sends, checks the VAPID signature (RFC 8292) and decrypts the message
 * (aes128gcm, RFC 8188 / RFC 8291) with the browser keys it handed out. HTTPS only, like the
 * real ones (web-push refuses anything else), with the throwaway certificate of scripts/ci.
 */

export type ReceivedPush = {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  /** Decrypted message, as the service worker would receive it. */
  plaintext: string;
  vapid: { audience: string; subject: string; expiresAt: number; publicKey: string };
};

/** One browser: the keys a real browser would generate when subscribing. */
export type FakeBrowser = {
  endpoint: string;
  /** Uncompressed P-256 public key, base64url (what PushSubscription.toJSON().keys.p256dh holds). */
  p256dh: string;
  auth: string;
};

const b64url = (buffer: Buffer) => buffer.toString("base64url");

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

/** RFC 8291 §3.4 + RFC 8188 §2: one record, padding delimiter 0x02 (last record). */
export function decryptAes128gcm(body: Buffer, ecdh: ECDH, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLength = body.readUInt8(20);
  const serverPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  if (ciphertext.length > recordSize) throw new Error("more than one record");

  const shared = ecdh.computeSecret(serverPublic);
  const browserPublic = ecdh.getPublicKey();
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), browserPublic, serverPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== 2) throw new Error("bad padding delimiter");
  return padded.subarray(0, end).toString("utf8");
}

/** RFC 8292: `Authorization: vapid t=<JWT>, k=<public key>`; ES256 signature checked. */
export function verifyVapid(header: string | undefined): ReceivedPush["vapid"] {
  const match = /^vapid t=([^,\s]+),\s*k=([A-Za-z0-9_-]+)$/.exec(header ?? "");
  if (!match) throw new Error("missing or malformed VAPID authorization");
  const [, token = "", publicKey = ""] = match;
  const [head = "", payload = "", signature = ""] = token.split(".");
  const header64 = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
  if (header64.alg !== "ES256") throw new Error(`unexpected JWT alg ${header64.alg}`);
  const raw = Buffer.from(publicKey, "base64url");
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64url(raw.subarray(1, 33)),
      y: b64url(raw.subarray(33, 65)),
    },
    format: "jwk",
  });
  const ok = verify(
    "sha256",
    Buffer.from(`${head}.${payload}`),
    { key, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"),
  );
  if (!ok) throw new Error("bad VAPID signature");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return { audience: claims.aud, subject: claims.sub, expiresAt: claims.exp, publicKey };
}

export class FakePushService {
  readonly received: ReceivedPush[] = [];
  /** Status answered to the next pushes (201 = accepted, like the real services). */
  status = 201;
  private server: Server | null = null;
  private browsers = new Map<string, { ecdh: ECDH; auth: Buffer }>();
  private origin = "";

  async start(): Promise<void> {
    const cert = process.env.PUSH_TEST_TLS_CERT;
    const key = process.env.PUSH_TEST_TLS_KEY;
    if (!cert || !key) throw new Error("PUSH_TEST_TLS_CERT / PUSH_TEST_TLS_KEY not set");
    this.server = createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const path = req.url ?? "";
        const browser = this.browsers.get(path);
        try {
          if (req.method !== "POST" || !browser)
            throw new Error(`unexpected ${req.method} ${path}`);
          this.received.push({
            path,
            headers: req.headers,
            plaintext: decryptAes128gcm(Buffer.concat(chunks), browser.ecdh, browser.auth),
            vapid: verifyVapid(req.headers.authorization),
          });
          res.writeHead(this.status).end();
        } catch (error) {
          this.received.push({
            path,
            headers: req.headers,
            plaintext: `ERROR: ${(error as Error).message}`,
            vapid: { audience: "", subject: "", expiresAt: 0, publicKey: "" },
          });
          res.writeHead(400).end();
        }
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.origin = `https://localhost:${(this.server.address() as AddressInfo).port}`;
  }

  /** The keys and endpoint of a new fake browser. */
  newBrowser(): FakeBrowser {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const auth = randomBytes(16);
    const path = `/push/${randomBytes(8).toString("hex")}`;
    this.browsers.set(path, { ecdh, auth });
    return {
      endpoint: `${this.origin}${path}`,
      p256dh: b64url(ecdh.getPublicKey()),
      auth: b64url(auth),
    };
  }

  get url(): string {
    return this.origin;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}
