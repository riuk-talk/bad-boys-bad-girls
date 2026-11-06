import "server-only";
import type { Composed } from "./compose";

const DEFAULT_URL = "https://api.resend.com/emails";
const SENDER_NAME = "Bad Boys & Bad Girls";

export type ResendConfig = { apiKey: string; from: string; url: string };

/** RESEND_API_KEY and EMAIL_FROM (server only); RESEND_API_URL only for the fake service of CI. */
export function resendConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return null;
  return { apiKey, from, url: process.env.RESEND_API_URL ?? DEFAULT_URL };
}

/**
 * One transactional e-mail through the HTTP API of Resend (no SDK). True when accepted. The
 * idempotency key is the e-mail's own id: if the route stops after Resend accepted it but before
 * the database knew, the e-mail claimed again is not sent twice (Resend keeps the key 24 h).
 */
export async function sendWithResend(
  config: ResendConfig,
  emailId: number,
  to: string,
  email: Composed,
  unsubscribe?: { url: string; oneClick: string },
): Promise<boolean> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "bad-boys-bad-girls/1.0",
      "idempotency-key": `email-outbox-${emailId}`,
    },
    body: JSON.stringify({
      // A bare address gets the site's name; « Name <address> » is kept as it is.
      from: config.from.includes("<") ? config.from : `"${SENDER_NAME}" <${config.from}>`,
      to: [to],
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(unsubscribe
        ? {
            headers: {
              "List-Unsubscribe": `<${unsubscribe.oneClick}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
        : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return response !== null && response.status >= 200 && response.status < 300;
}
