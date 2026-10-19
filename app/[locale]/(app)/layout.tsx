import type { ReactNode } from "react";
import { AppHeader } from "@/components/app/app-header";
import { TabBar } from "@/components/app/tab-bar";
import { ClientIntl } from "@/components/i18n/client-intl";
import { ToastProvider } from "@/components/ui/toast";
import { accentForGender } from "@/lib/accent";
import { requireMember } from "@/lib/auth/user";
import { parseRole } from "@/lib/onboarding/config";

// Every page of this group requires a session (SPEC §2: nothing is public).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const member = await requireMember();
  const [{ data: profile }, , { data: adminRole }] = await Promise.all([
    member.supabase
      .from("profiles")
      .select("onboarding_completed_at, role, gender")
      .eq("id", member.userId)
      .maybeSingle(),
    // Last activity (at most one write per hour, in SQL): only active Bads count for a zone.
    member.supabase.rpc("touch_activity"),
    // The Admin link shows for admins whatever the factor level: /admin asks for the second one.
    member.supabase.rpc("my_admin_role"),
  ]);

  // The interface takes the colour of the connected member's gender (PARCOURS-DESIGN §1).
  const accent = accentForGender(profile?.gender);
  const role = parseRole(profile?.role);
  return (
    <div className="flex min-h-dvh flex-col" data-accent={accent === "gold" ? undefined : accent}>
      <AppHeader
        onboardingDone={Boolean(profile?.onboarding_completed_at)}
        role={role}
        isAdmin={adminRole === "admin" || adminRole === "super_admin"}
      />
      <ClientIntl>
        <ToastProvider>
          <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
            {children}
          </main>
        </ToastProvider>
        {profile?.onboarding_completed_at && role ? <TabBar role={role} /> : null}
      </ClientIntl>
    </div>
  );
}
