// Server-rendered localized link: next-intl's <Link> is a client component that ships the i18n
// runtime to every page (SPEC §18 JS budget). Client components keep using @/i18n/navigation.
// eslint-disable-next-line no-restricted-imports
import NextLink from "next/link";
import { getLocale } from "next-intl/server";
import type { ComponentProps } from "react";
import type { Locale } from "@/i18n/routing";
import { localizedPath } from "@/lib/i18n-path";

type Props = Omit<ComponentProps<typeof NextLink>, "href"> & { href: string; locale?: Locale };

export async function LocalizedLink({ href, locale, ...props }: Props) {
  const target = locale ?? ((await getLocale()) as Locale);
  return <NextLink href={localizedPath(href, target)} {...props} />;
}
