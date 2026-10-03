import type { ReactNode } from "react";
import { AppHeader } from "@/components/app/app-header";
import { ClientIntl } from "@/components/i18n/client-intl";
import { ToastProvider } from "@/components/ui/toast";
import { requireMember } from "@/lib/auth/user";

// Every page of this group requires a session (SPEC §2: nothing is public).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const member = await requireMember();
  const { data: profile } = await member.supabase
    .from("profiles")
    .select("onboarding_completed_at")
    .eq("id", member.userId)
    .maybeSingle();

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader onboardingDone={Boolean(profile?.onboarding_completed_at)} />
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
