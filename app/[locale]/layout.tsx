import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { ErrorStrings } from "@/components/errors/error-strings";
import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/env";
import { fontVariables } from "@/lib/fonts";
import "../globals.css";

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t("defaultTitle"), template: t("titleTemplate") },
    description: t("description"),
    applicationName: t("siteName"),
    // Default for every page; indexable pages opt in explicitly (lib/seo.ts).
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: t("siteName"),
      locale: locale === "fr" ? "fr_FR" : "en_GB",
      images: [{ url: "/brand/og.jpg", width: 1200, height: 630, alt: t("ogAlt") }],
    },
    twitter: { card: "summary_large_image" },
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#0E0E10",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Common");

  return (
    <html lang={locale} className={fontVariables}>
      <body>
        <a
          href="#main"
          className="bg-gold text-ink sr-only z-50 rounded-md px-4 py-2 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          {t("skipToContent")}
        </a>
        {children}
        <ErrorStrings />
      </body>
    </html>
  );
}
