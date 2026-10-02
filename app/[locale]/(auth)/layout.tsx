import type { ReactNode } from "react";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ClientIntl } from "@/components/i18n/client-intl";
import { ToastProvider } from "@/components/ui/toast";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader showAuthLinks={false} />
      <ClientIntl>
        <ToastProvider>
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10 focus:outline-none sm:px-6"
          >
            {children}
          </main>
        </ToastProvider>
      </ClientIntl>
      <SiteFooter />
    </div>
  );
}
