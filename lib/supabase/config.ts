/** Public Supabase configuration (safe in the browser: every table is protected by RLS). */
export function supabaseConfig(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example).",
    );
  }
  return { url, publishableKey };
}

/** True when an auth cookie is present: lets public pages skip any Supabase round-trip. */
export function hasAuthCookie(names: string[]): boolean {
  return names.some((name) => name.startsWith("sb-") && name.includes("-auth-token"));
}
