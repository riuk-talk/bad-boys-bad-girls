import { SITE_URL } from "@/lib/env";

/** Only same-site relative paths are accepted as post-login destinations (no open redirect). */
export function safeNextPath(value: string | null | undefined, fallback = "/onboarding"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return fallback;
  return value;
}

/** Link target in auth e-mails. Must be listed in Supabase Auth → URL Configuration. */
export function confirmUrl(next: string): string {
  return `${SITE_URL}/api/auth/confirm?next=${encodeURIComponent(safeNextPath(next))}`;
}
