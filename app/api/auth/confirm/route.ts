import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = [
  "signup",
  "magiclink",
  "recovery",
  "email",
  "invite",
  "email_change",
];

/**
 * Landing point of every auth e-mail link. Supports the token_hash links (recommended e-mail
 * templates, work across browsers) and the PKCE ?code= links (default templates).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  if (!ok) return NextResponse.redirect(new URL("/connexion?erreur=lien", origin));
  const destination = type === "recovery" ? "/nouveau-mot-de-passe" : next;
  return NextResponse.redirect(new URL(destination, origin));
}
