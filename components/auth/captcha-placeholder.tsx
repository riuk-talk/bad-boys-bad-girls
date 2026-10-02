import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

/** Slot for the Cloudflare Turnstile widget, wired to Supabase Auth in Phase 2. */
export function CaptchaPlaceholder() {
  const t = useTranslations("Auth");
  return (
    <div
      role="group"
      aria-label={t("captchaLabel")}
      className="border-line text-grey flex min-h-16 items-center gap-3 rounded-lg border border-dashed px-4 text-sm"
    >
      <ShieldCheck aria-hidden="true" className="size-5 shrink-0" />
      {t("captchaPending")}
    </div>
  );
}
