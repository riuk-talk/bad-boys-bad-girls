import "server-only";
import type { Composed } from "./compose";

const DEFAULT_URL = "https://api.brevo.com/v3/smtp/email";

export type BrevoConfig = { apiKey: string; from: string; url: string };

/** BREVO_API_KEY and EMAIL_FROM (server only); BREVO_API_URL only for the fake service of CI. */
export function brevoConfig(): BrevoConfig | null {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return null;
  return { apiKey, from, url: process.env.BREVO_API_URL ?? DEFAULT_URL };
}

/** One transactional e-mail through the HTTP API of Brevo (no SDK). True when accepted. */
export async function sendWithBrevo(
  config: BrevoConfig,
  to: string,
  email: Composed,
  unsubscribe?: { url: string; oneClick: string },
): Promise<boolean> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "api-key": config.apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Bad Boys & Bad Girls", email: config.from },
      to: [{ email: to }],
      subject: email.subject,
      textContent: email.text,
      htmlContent: email.html,
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
