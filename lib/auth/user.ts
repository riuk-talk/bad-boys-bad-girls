import "server-only";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

/** Signed-in member (JWT validated by Supabase), or a redirect to the login page. */
export async function requireMember() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) {
    return redirect({ href: "/connexion", locale: await getLocale() });
  }
  const metadata = (claims.user_metadata ?? {}) as Record<string, unknown>;
  // Authenticator assurance level of this session: "aal2" once a second factor is verified.
  const aal = typeof claims.aal === "string" ? claims.aal : "aal1";
  return { supabase, userId: claims.sub, metadata, aal };
}
