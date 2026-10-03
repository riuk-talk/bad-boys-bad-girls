import type { ReactNode } from "react";
import { AppHeader } from "@/components/app/app-header";
import { ClientIntl } from "@/components/i18n/client-intl";
import { ToastProvider } from "@/components/ui/toast";
import { requireMember } from "@/lib/auth/user";
import { parseRole } from "@/lib/onboarding/config";

// Every page of this group requires a session (SPEC §2: nothing is public).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const member = await requireMember();
  const [{ data: profile }] = await Promise.all([
    member.supabase
      .from("profiles")
      .select("onboarding_completed_at, role")
      .eq("id", member.userId)
      .maybeSingle(),
    // Last activity (at most one write per hour, in SQL): only active Bads count for a zone.
    member.supabase.rpc("touch_activity"),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader
        onboardingDone={Boolean(profile?.onboarding_completed_at)}
        role={parseRole(profile?.role)}
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
