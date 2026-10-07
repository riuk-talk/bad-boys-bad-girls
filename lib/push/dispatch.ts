import { timingSafeEqual } from "node:crypto";

/**
 * Pure pieces of the Web Push route (/api/cron/push), kept apart so they can be unit-tested
 * without a database or a push service.
 */

/** Constant-time check of "Authorization: Bearer <secret>". A missing secret never matches. */
export function isAuthorizedCron(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * VAPID contact (RFC 8292): an https: URL or a mailto: address, nothing else. web-push throws on
 * anything else, and each message would then fail silently until given up: the route refuses to
 * run instead (503 push_misconfigured).
 */
export function isValidVapidSubject(subject: string): boolean {
  let url: URL;
  try {
    url = new URL(subject);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return url.hostname !== "";
  if (url.protocol === "mailto:") return /^[^@\s]+@[^@\s]+$/.test(url.pathname);
  return false;
}

export type PushLocale = "fr" | "en";

/**
 * What travels through the push service: the notification type and an internal path, nothing
 * else (never a pseudo, a photo or a message: SPEC §7 quater). The texts live in the service
 * worker. The English site lives under /en (localePrefix "as-needed").
 */
export function pushPayload(type: string, path: unknown, locale: PushLocale): string {
  const safe = typeof path === "string" && /^\/[a-z0-9/-]*$/.test(path) ? path : "/";
  const url = locale === "en" ? (safe === "/" ? "/en" : `/en${safe}`) : safe;
  return JSON.stringify({ t: type, u: url });
}

/** How a push service answer is filed: 404/410 mean the browser unsubscribed for good. */
export function classifyPushError(statusCode: number | undefined): "gone" | "failed" {
  return statusCode === 404 || statusCode === 410 ? "gone" : "failed";
}

export type SubscriptionOutcome = "delivered" | "gone" | "failed";

/**
 * The fate of one message from the outcomes of its browsers: sent as soon as one browser got it,
 * retried if one failed for a passing reason, skipped when there was nobody (left) to send to.
 */
export function messageOutcome(outcomes: SubscriptionOutcome[]): "sent" | "retry" | "skipped" {
  if (outcomes.includes("delivered")) return "sent";
  if (outcomes.includes("failed")) return "retry";
  return "skipped";
}

export type PushReport = {
  sent: number[];
  retry: number[];
  skipped: number[];
  delivered: string[];
  gone: string[];
  failed: string[];
};

export function emptyReport(): PushReport {
  return { sent: [], retry: [], skipped: [], delivered: [], gone: [], failed: [] };
}
