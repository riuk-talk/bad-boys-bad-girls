"use client";

import { useTranslations } from "next-intl";
import type { EmailWarning } from "@/lib/auth/email-typo";

/**
 * A mistyped address (10d): a warning under the field, never a refusal; « Tu voulais dire … ? »
 * puts the suggestion in the field.
 */
export function EmailHint({
  warning,
  onAccept,
}: {
  warning: EmailWarning | null;
  onAccept: (email: string) => void;
}) {
  const t = useTranslations("Auth");
  return (
    <p role="status" className="text-gold -mt-3 text-sm">
      {warning?.kind === "suggestion"
        ? t.rich("emailSuggestion", {
            email: () => (
              <button
                type="button"
                onClick={() => onAccept(warning.email)}
                className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
              >
                {warning.email}
              </button>
            ),
          })
        : warning?.kind === "unknown_tld"
          ? t("emailUnknownTld")
          : null}
    </p>
  );
}
