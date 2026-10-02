import { getTranslations } from "next-intl/server";

export const ERROR_STRINGS_ID = "i18n-error-strings";

/**
 * Translated strings for the client error boundary, rendered on the server into an inert
 * <template>. The boundary reads them from the DOM instead of loading the i18n runtime.
 */
export async function ErrorStrings() {
  const t = await getTranslations("Errors");
  const common = await getTranslations("Common");
  return (
    <template
      id={ERROR_STRINGS_ID}
      data-stamp={t("errorStamp")}
      data-title={t("errorTitle")}
      data-body={t("errorBody")}
      data-retry={common("retry")}
    />
  );
}
