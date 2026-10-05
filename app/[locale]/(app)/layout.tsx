import type { ReactNode } from "react";
import { AppHeader } from "@/components/app/app-header";
import { ClientIntl } from "@/components/i18n/client-intl";
import { ToastProvider } from "@/components/ui/toast";
import { accentForGender } from "@/lib/accent";
import { requireMember } from "@/lib/auth/user";
import { parseRole } from "@/lib/onboarding/config";

// Every page of this group requires a session (SPEC §2: nothing is public).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const member = await requireMember();
  const [{ data: profile }, , { data: isAdmin }] = await Promise.all([
    member.supabase
      .from("profiles")
      .select("onboarding_completed_at, role, gender")
      .eq("id", member.userId)
      .maybeSingle(),
    // Last activity (at most one write per hour, in SQL): only active Bads count for a zone.
    member.supabase.rpc("touch_activity"),
    member.supabase.rpc("is_admin"),
  ]);

  // The interface takes the colour of the connected member's gender (PARCOURS-DESIGN §1).
  const accent = accentForGender(profile?.gender);
  return (
    <div className="flex min-h-dvh flex-col" data-accent={accent === "gold" ? undefined : accent}>
      <AppHeader
        onboardingDone={Boolean(profile?.onboarding_completed_at)}
        role={parseRole(profile?.role)}
        isAdmin={isAdmin === true}
      />
      <ClientIntl>
        <ToastProvider>
          <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
            {children}
          </main>
        </ToastProvider>
      </ClientIntl>
    </div>
  );
}
