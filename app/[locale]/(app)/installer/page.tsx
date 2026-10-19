import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/ui/button-link";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Push.install" });
  return { title: t("title") };
}

const STEPS = ["step1", "step2", "step3", "step4", "step5"] as const;

/** Guide d'installation iPhone (SPEC §7 quater): Web Push works only from the home screen. */
export default async function InstallGuidePage() {
  const t = await getTranslations("Push.install");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl tracking-wide uppercase">{t("title")}</h1>
      <p className="text-cream/90">{t("lead")}</p>
      <ol className="flex flex-col gap-3">
        {STEPS.map((step, index) => (
          <li key={step} className="border-line bg-ink-2 flex gap-3 rounded-md border p-3">
            <span
              aria-hidden="true"
              className="bg-accent text-ink flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
            >
              {index + 1}
            </span>
            <span>{t(step)}</span>
          </li>
        ))}
      </ol>
      <p className="text-grey text-sm">{t("version")}</p>
      <p className="text-grey text-sm">{t("android")}</p>
      <ButtonLink href="/ma-fiche" variant="secondary" className="self-start">
        {t("back")}
      </ButtonLink>
    </div>
  );
}
