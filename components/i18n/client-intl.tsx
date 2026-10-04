import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
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
] as const;

/**
 * Client i18n runtime (~11 kB gzip). Mounted only by the layouts whose pages have
 * interactive translated components, never on the public pages (SPEC §18 JS budget).
 */
export async function ClientIntl({ children }: { children: ReactNode }) {
  const messages = await getMessages();
  const subset = Object.fromEntries(CLIENT_NAMESPACES.map((ns) => [ns, messages[ns]]));
  return <NextIntlClientProvider messages={subset}>{children}</NextIntlClientProvider>;
}
