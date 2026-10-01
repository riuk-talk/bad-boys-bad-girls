import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "en"],
  defaultLocale: "fr",
  localePrefix: "as-needed",
  // French is the launch language; English is prepared but never auto-selected from the browser.
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
