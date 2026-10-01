import { useTranslations } from "next-intl";
import { ErrorScreen } from "@/components/errors/error-screen";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ButtonLink } from "@/components/ui/button-link";

export default function NotFound() {
  const t = useTranslations();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <ErrorScreen
          stamp="dismissed"
          title={t("Errors.notFoundTitle")}
          body={t("Errors.notFoundBody")}
          action={<ButtonLink href="/">{t("Common.backHome")}</ButtonLink>}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
