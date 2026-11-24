import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { SITE_TIME_ZONE } from "@/lib/time-zone";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    // Dates and hours in the clock of France, never the server's (UTC on Vercel, 10i).
    timeZone: SITE_TIME_ZONE,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
