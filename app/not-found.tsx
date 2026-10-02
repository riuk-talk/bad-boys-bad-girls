import { getTranslations } from "next-intl/server";
import { LocalizedLink } from "@/components/i18n/localized-link";
import "./globals.css";

// Fallback for requests that never reach the [locale] segment.
export default async function GlobalNotFound() {
  const t = await getTranslations({ locale: "fr", namespace: "Errors" });
  const common = await getTranslations({ locale: "fr", namespace: "Common" });
  return (
    <html lang="fr">
      <body className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-3xl font-bold">{t("notFoundTitle")}</h1>
        <p>{t("notFoundBody")}</p>
        <LocalizedLink href="/" locale="fr" className="underline">
          {common("backHome")}
        </LocalizedLink>
      </body>
    </html>
  );
}
