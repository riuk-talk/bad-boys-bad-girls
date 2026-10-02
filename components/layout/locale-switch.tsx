// Server component: plain links, no client i18n runtime (SPEC §18). Changing language reloads
// the page, which is expected (different <html lang>).
// eslint-disable-next-line no-restricted-imports
import NextLink from "next/link";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/cn";
import { localizedPath } from "@/lib/i18n-path";
import { stripLocale } from "@/lib/seo";

export async function LocaleSwitch({ className }: { className?: string }) {
  const t = await getTranslations("Common");
  const current = await getLocale();
  const basePath = stripLocale((await headers()).get("x-pathname") ?? "/");

  return (
    <nav aria-label={t("languageSwitch")} className={cn("flex items-center gap-1", className)}>
      {routing.locales.map((target) => (
        <NextLink
          key={target}
          href={localizedPath(basePath, target)}
          prefetch={false}
          lang={target}
          hrefLang={target}
          aria-current={target === current ? "true" : undefined}
          className={cn(
            "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 text-sm font-semibold uppercase",
            target === current ? "text-gold" : "text-grey hover:text-cream",
          )}
        >
          <span aria-hidden="true">{target}</span>
          <span className="sr-only">{t(`languageNames.${target}`)}</span>
        </NextLink>
      ))}
    </nav>
  );
}
