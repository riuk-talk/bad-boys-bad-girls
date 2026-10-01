import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { IS_PRODUCTION_DEPLOYMENT } from "@/lib/env";
import { ClientIntl } from "@/components/i18n/client-intl";
import { ToastProvider } from "@/components/ui/toast";
import { DesignShowcase } from "./showcase";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Design" });
  return { title: t("title") };
}

// Development showcase of the design system; hidden on the production deployment.
export default async function DesignPage({ params }: Props) {
  if (IS_PRODUCTION_DEPLOYMENT) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main id="main" tabIndex={-1} className="focus:outline-none">
      <ClientIntl>
        <ToastProvider>
          <DesignShowcase />
        </ToastProvider>
      </ClientIntl>
    </main>
  );
}
