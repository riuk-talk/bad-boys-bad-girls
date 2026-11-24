import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTimeZone } from "next-intl/server";
import type { ReactNode } from "react";

// Only the namespaces used by client components are sent to the browser.
const CLIENT_NAMESPACES = [
  "Common",
  "Components",
  "Auth",
  "Design",
  "Onboarding",
  "MyFiche",
  "Quarter",
  "Interrogation",
  "Greffe",
  "Relations",
  "Prompter",
  "Push",
  "AdminAccess",
  "MyData",
  "AdminShell",
  "GreffeMail",
  "AccountSecurity",
] as const;

/**
 * Client i18n runtime (~11 kB gzip). Mounted only by the layouts whose pages have
 * interactive translated components, never on the public pages (SPEC §18 JS budget).
 */
export async function ClientIntl({ children }: { children: ReactNode }) {
  const [messages, timeZone] = await Promise.all([getMessages(), getTimeZone()]);
  const subset = Object.fromEntries(CLIENT_NAMESPACES.map((ns) => [ns, messages[ns]]));
  // The same clock in the browser as on the server (10i): no hour shown in the device's zone.
  return (
    <NextIntlClientProvider messages={subset} timeZone={timeZone}>
      {children}
    </NextIntlClientProvider>
  );
}
