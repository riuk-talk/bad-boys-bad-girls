import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { hasAuthCookie, supabaseConfig } from "./config";
import type { Database } from "./database.types";

/**
 * Refreshes the auth session cookies on the way through proxy.ts. Skipped entirely when the
 * visitor has no auth cookie (public pages stay free of any Supabase call).
 */
export async function refreshSession(request: NextRequest, response: NextResponse): Promise<void> {
  if (!hasAuthCookie(request.cookies.getAll().map((cookie) => cookie.name))) return;
  const { url, publishableKey } = supabaseConfig();
  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(toSet, headers) {
        for (const { name, value, options } of toSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });
  // getClaims() validates the JWT and refreshes it when expired.
  await supabase.auth.getClaims();
}
