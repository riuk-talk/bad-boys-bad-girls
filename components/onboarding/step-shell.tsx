import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ONBOARDING_STEPS } from "@/lib/onboarding/config";

export async function StepShell({ step, children }: { step: number; children: ReactNode }) {
  const t = await getTranslations("Onboarding");
  const percent = Math.round((step / ONBOARDING_STEPS) * 100);
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="text-gold text-sm font-bold tracking-[0.2em] uppercase">{t("title")}</p>
      <div className="text-grey mt-3 flex items-center justify-between gap-3 text-sm">
        <span>{t("progress", { current: step, total: ONBOARDING_STEPS })}</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={ONBOARDING_STEPS}
        aria-valuenow={step}
        aria-valuetext={t("progress", { current: step, total: ONBOARDING_STEPS })}
        className="bg-ink-3 mt-2 h-2 overflow-hidden rounded-full"
      >
        <div className="bg-gold h-full rounded-full" style={{ width: `${percent}%` }} />
      </div>
      <h1 className="font-display mt-6 text-4xl tracking-wide uppercase">
        {t(`steps.${step as 1 | 2 | 3 | 4}`)}
      </h1>
      <div className="mt-6">{children}</div>
      <p className="text-grey mt-8 text-sm">{t("savedNotice")}</p>
      <p className="text-grey text-sm">{t("deletionNotice")}</p>
    </div>
  );
}
