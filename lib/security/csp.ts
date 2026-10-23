/**
 * Content-Security-Policy builder (SPEC §10).
 * Scripts: per-request nonce + 'strict-dynamic' (no 'unsafe-inline', no host allowlist).
 * Styles: 'unsafe-inline' is kept because React renders style attributes server-side;
 * CSS injection is far less dangerous than script injection (decision documented in PROGRESS.md).
 */
export function buildCsp(
  nonce: string,
  options: { isDev: boolean; supabaseUrl?: string; https?: boolean },
): string {
  const supabase = options.supabaseUrl ?? "";
  // Realtime: wss:// for https://, ws:// for the local stack (WebKit does not derive one from the other).
  const supabaseWs = supabase.replace(/^http(s?):/, "ws$1:");
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(options.isDev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(supabase ? [supabase] : [])],
    "font-src": ["'self'"],
    "connect-src": [
      "'self'",
      ...(supabase ? [supabase, supabaseWs] : []),
      ...(options.isDev ? ["ws:"] : []),
    ],
    "frame-src": ["https://challenges.cloudflare.com"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");
  // Only over HTTPS (always the case in production); on http://localhost it would break assets.
  return options.https ? `${policy}; upgrade-insecure-requests` : policy;
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The policy of the cut-out worker (public/workers/cutout-worker.js, next.config.ts): scripts and
 * requests from the site only, plus WebAssembly (never JS eval). A dedicated worker gets its own
 * policy from its response, so the pages never need to allow WebAssembly.
 */
export const CUTOUT_WORKER_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";
