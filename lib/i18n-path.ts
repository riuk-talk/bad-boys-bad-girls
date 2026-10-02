import { routing, type Locale } from "@/i18n/routing";

/**
 * Localized path for the "as-needed" prefix strategy (fr: no prefix, en: /en).
 * Pure function: importing @/i18n/navigation on the server would pull next-intl's client
 * <Link> into every page bundle (SPEC §18).
 */
export function localizedPath(href: string, locale: Locale): string {
  if (locale === routing.defaultLocale) return href;
  return href === "/" ? `/${locale}` : `/${locale}${href}`;
}
