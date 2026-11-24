import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";

export type PasswordCheck = "ok" | "wrongPassword" | "captchaFailed" | "rateLimited";

/**
 * Checks the current password of an account with a throw-away client: the member's own session is
 * left as it is. It is a sign-in, so Supabase Auth asks for the anti-robot token when the captcha
 * is on, and counts it in its sign-in rate limit. The session it opens is closed at once.
 */
export async function verifyPassword(
  email: string,
  password: string,
  captchaToken: string | undefined,
): Promise<PasswordCheck> {
  const { url, publishableKey } = supabaseConfig();
  const checker = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await checker.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  });
  if (error) {
    if (error.code === "captcha_failed") return "captchaFailed";
    if (error.status === 429) return "rateLimited";
    return "wrongPassword";
  }
  // Only this check's session: never the member's other ones.
  await checker.auth.signOut({ scope: "local" });
  return "ok";
}
