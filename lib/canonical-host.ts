/**
 * The production site answers on one host only. Turnstile (the anti-robot check) is allowed on
 * bad-boys8bad-girls.fr and www only: on another host of the production deployment
 * (bad-boys-bad-girls.vercel.app, *-riuk.vercel.app), the widget would refuse to load and nobody
 * could sign in. Such a request is sent to the same path and query on the canonical host, with a
 * permanent 308 (the method and body are kept). Previews and local development are left alone.
 */
export const CANONICAL_HOST = "bad-boys8bad-girls.fr";
const ALLOWED_HOSTS = new Set([CANONICAL_HOST, `www.${CANONICAL_HOST}`]);

/** The canonical URL to redirect to, or null when the request may be served as it is. */
export function canonicalRedirect(
  url: URL,
  host: string | null,
  vercelEnv: string | undefined,
): string | null {
  if (vercelEnv !== "production") return null;
  const name = (host ?? url.host).trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (ALLOWED_HOSTS.has(name)) return null;
  return `https://${CANONICAL_HOST}${url.pathname}${url.search}`;
}
