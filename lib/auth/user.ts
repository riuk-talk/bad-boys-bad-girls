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

/**
 * A page of the member area. An account with an administration role has none while it holds the
 * role (10f: its profile is withdrawn from the site): it goes to /admin. « Mes données » and the
 * installation page stay open to it (requireMember).
 */
export async function requireMemberArea() {
  const member = await requireMember();
  const { data: role } = await member.supabase.rpc("my_admin_role");
  if (role === "admin" || role === "super_admin") {
    return redirect({ href: "/admin", locale: await getLocale() });
  }
  return member;
}
