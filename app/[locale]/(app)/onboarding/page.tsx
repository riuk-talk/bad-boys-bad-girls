import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { lastStep, parseRole, ROLE_STEP, stepPath } from "@/lib/onboarding/config";

// Resumes the onboarding where the member left it (SPEC §4: save and resume at every step).
export default async function OnboardingEntry() {
  const member = await requireMember();
  const locale = await getLocale();
  // The super admin has no profile and no onboarding (Phase 5a-ter): straight to /admin.
  const { data: adminRole } = await member.supabase.rpc("my_admin_role");
  if (adminRole === "super_admin") return redirect({ href: "/admin", locale });
  const { data: profile } = await member.supabase
    .from("profiles")
    .select("onboarding_step, onboarding_completed_at, role")
    .eq("id", member.userId)
    .maybeSingle();
  if (profile?.onboarding_completed_at) return redirect({ href: "/ma-fiche", locale });
  const role = parseRole(profile?.role);
  const reachable = role ? lastStep(role) : ROLE_STEP;
  const next = Math.min((profile?.onboarding_step ?? 0) + 1, reachable);
  return redirect({ href: stepPath(next), locale });
}
