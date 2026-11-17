import type { ReactNode } from "react";
import { AppHeader } from "@/components/app/app-header";
import { OfflineNotice } from "@/components/app/offline-notice";
import { SanctionNotice } from "@/components/app/sanction-notice";
import { TabBar } from "@/components/app/tab-bar";
import { ClientIntl } from "@/components/i18n/client-intl";
import { ToastProvider } from "@/components/ui/toast";
import { accentForGender } from "@/lib/accent";
import { requireMember } from "@/lib/auth/user";
import { sanctionSchema } from "@/lib/moderation";
import { parseRole } from "@/lib/onboarding/config";

// Every page of this group requires a session (SPEC §2: nothing is public).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const member = await requireMember();
  const [{ data: profile }, , { data: adminRole }, { data: sanctionData }] = await Promise.all([
    member.supabase
      .from("profiles")
      .select("onboarding_completed_at, role, gender")
      .eq("id", member.userId)
      .maybeSingle(),
    // Last activity (at most one write per hour, in SQL): only active Bads count for a zone.
    member.supabase.rpc("touch_activity"),
    // The Admin link shows for admins whatever the factor level: /admin asks for the second one.
    member.supabase.rpc("my_admin_role"),
    // A sanction in force (Phase 7a) replaces the site with its exposé des motifs.
    member.supabase.rpc("get_my_sanction"),
  ]);
  const parsedSanction = sanctionSchema.safeParse(sanctionData ?? null);
  const sanction = parsedSanction.success ? parsedSanction.data : null;

  // The interface takes the colour of the connected member's gender (PARCOURS-DESIGN §1).
  const accent = accentForGender(profile?.gender);
  const role = parseRole(profile?.role);
  // An account with an administration role has no member area while it holds it (10f).
  const isAdmin = adminRole === "admin" || adminRole === "super_admin";
  const memberArea = Boolean(profile?.onboarding_completed_at) && !isAdmin;
  return (
    <div className="flex min-h-dvh flex-col" data-accent={accent === "gold" ? undefined : accent}>
      <AppHeader onboardingDone={memberArea} role={role} isAdmin={isAdmin} />
      <ClientIntl>
        <OfflineNotice />
        <ToastProvider>
          <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
            {sanction ? <SanctionNotice sanction={sanction} /> : children}
          </main>
        </ToastProvider>
        {memberArea && role && !sanction ? <TabBar role={role} /> : null}
      </ClientIntl>
    </div>
  );
}
