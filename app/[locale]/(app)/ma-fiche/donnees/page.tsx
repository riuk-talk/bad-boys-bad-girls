import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DeleteAccount } from "@/components/app/delete-account";
import { buttonClasses } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/user";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "MyData" });
  return { title: t("title") };
}

/** Mes données (SPEC §10): the export as a JSON file and the real deletion of the account. */
export default async function MyDataPage() {
  await requireMember();
  const t = await getTranslations("MyData");
  return (
    <div className="mx-auto max-w-2xl space-y-10 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
      <section aria-labelledby="export-title" className="space-y-3">
        <h2 id="export-title" className="font-display text-2xl tracking-wide uppercase">
          {t("exportTitle")}
        </h2>
        <p className="text-cream/85">{t("exportLead")}</p>
        {/* A file download, not a page: a plain link. */}
        <a href="/api/me/export" download className={buttonClasses("secondary", "md")}>
          {t("export")}
        </a>
      </section>
      <section aria-labelledby="delete-title" className="space-y-3">
        <h2 id="delete-title" className="font-display text-2xl tracking-wide uppercase">
          {t("deleteTitle")}
        </h2>
        <p className="text-cream/85">{t("deleteLead")}</p>
        <DeleteAccount />
      </section>
    </div>
  );
}
