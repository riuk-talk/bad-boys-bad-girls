import createIntlMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { isIndexable } from "@/lib/seo";
import { buildCsp, generateNonce } from "@/lib/security/csp";

const intl = createIntlMiddleware(routing);

export default function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce, {
    isDev: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    https: request.nextUrl.protocol === "https:",
  });

  // Next.js reads the nonce from the request CSP header and applies it to its own scripts.
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);
  request.headers.set("x-pathname", request.nextUrl.pathname);

  const response = intl(request);
  response.headers.set("content-security-policy", csp);
  if (!isIndexable(request.nextUrl.pathname)) {
    response.headers.set("x-robots-tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  // Everything except API routes, Next internals and static files.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
