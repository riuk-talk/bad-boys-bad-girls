import { Gavel, Moon, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { Stamp } from "@/components/brand/stamp";
import { ButtonLink } from "@/components/ui/button-link";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { indexableMetadata } from "@/lib/seo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return indexableMetadata(locale, "/");
}

type Step = { title: string; body: string };

export default function LandingPage({ params }: Props) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Landing");
  const common = useTranslations("Common");
  const steps = t.raw("steps") as Step[];
  const judgePoints = t.raw("judgePoints") as string[];
  const charterPoints = t.raw("charterPoints") as string[];

  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 pt-8 pb-14 sm:px-6 md:grid-cols-2 md:pt-14">
        <div className="order-2 space-y-6 md:order-1">
          <p className="text-gold text-sm font-bold tracking-[0.2em] uppercase">
            {t("heroEyebrow")}
          </p>
          <h1 className="font-display text-5xl leading-[1.05] tracking-wide uppercase sm:text-6xl">
            {t("heroTitle")}
          </h1>
          <p className="text-cream/90 max-w-prose text-lg">{t("heroLead")}</p>
          <p className="font-display text-red text-2xl tracking-wide uppercase">
            {common("promise")}
          </p>
          <div className="flex flex-col gap-3 min-[420px]:flex-row">
            <ButtonLink href="/inscription" size="lg">
              {t("heroCtaPrimary")}
            </ButtonLink>
            <ButtonLink href="/connexion" variant="secondary" size="lg">
              {t("heroCtaSecondary")}
            </ButtonLink>
          </div>
        </div>
        <div className="order-1 mx-auto w-full max-w-[22rem] md:order-2 md:max-w-[30rem]">
          {/* Plain <img>: the asset is pre-optimised (scripts/build-brand-assets.mjs) and
              next/image would add a client component to the landing (SPEC §18 JS budget). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-3d-560.avif"
            srcSet="/brand/logo-3d-360.avif 360w, /brand/logo-3d-560.avif 560w, /brand/logo-3d-840.avif 840w"
            sizes="(min-width: 768px) 30rem, 22rem"
            alt={t("logoAlt")}
            width={560}
            height={560}
            fetchPriority="high"
            decoding="async"
            className="h-auto w-full"
          />
        </div>
      </section>

      <section aria-labelledby="steps-title" className="border-line/60 bg-ink-2 border-y">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2
            id="steps-title"
            className="font-display text-4xl tracking-wide uppercase sm:text-5xl"
          >
            {t("stepsTitle")}
          </h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="bg-ink-3 rounded-[var(--radius-card)] p-6">
                <p aria-hidden="true" className="font-display text-gold text-6xl">
                  {index + 1}
                </p>
                <h3 className="font-display mt-2 text-2xl tracking-wide uppercase">{step.title}</h3>
                <p className="text-cream/85 mt-2">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="judge-title" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h2
              id="judge-title"
              className="font-display flex items-center gap-3 text-4xl tracking-wide uppercase sm:text-5xl"
            >
              <Gavel aria-hidden="true" className="text-gold size-10 shrink-0" />
              {t("judgeTitle")}
            </h2>
            <p className="mt-4 max-w-prose text-lg">{t("judgeBody")}</p>
            <ul className="mt-6 space-y-3">
              {judgePoints.map((point) => (
                <li key={point} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="bg-gold mt-2.5 size-2 shrink-0 rounded-full"
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-center md:pr-6">
            <Stamp kind="released" size="lg" tilt={-10} />
          </div>
        </div>
      </section>

      <section aria-labelledby="hearing-title" className="border-line/60 bg-ink-2 border-y">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-14 sm:px-6 md:flex-row md:items-center md:gap-10">
          <Moon aria-hidden="true" className="text-gold size-14 shrink-0" />
          <div>
            <h2
              id="hearing-title"
              className="font-display text-4xl tracking-wide uppercase sm:text-5xl"
            >
              {t("hearingTitle")}
            </h2>
            <p className="mt-3 max-w-prose text-lg">{t("hearingBody")}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="charter-title" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="paper rounded-[var(--radius-card)] p-6 shadow-[var(--shadow-paper)] sm:p-10">
          <h2
            id="charter-title"
            className="font-display flex items-center gap-3 text-4xl tracking-wide uppercase sm:text-5xl"
          >
            <ScrollText aria-hidden="true" className="text-red-ink size-10 shrink-0" />
            {t("charterTitle")}
          </h2>
          <p className="mt-3 text-lg">{t("charterLead")}</p>
          <ul className="font-stamp mt-6 grid gap-3 text-lg sm:grid-cols-3">
            {charterPoints.map((point) => (
              <li key={point} className="border-red-ink border-l-4 pl-3">
                {point}
              </li>
            ))}
          </ul>
          <LocalizedLink
            href="/charte"
            className="decoration-red-ink mt-6 inline-flex min-h-11 items-center font-semibold underline decoration-2 underline-offset-4"
          >
            {t("charterLink")}
          </LocalizedLink>
        </div>
      </section>

      <section aria-labelledby="cities-title" className="border-line/60 bg-ink-2 border-t">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2
            id="cities-title"
            className="font-display text-4xl tracking-wide uppercase sm:text-5xl"
          >
            {t("citiesTitle")}
          </h2>
          <p className="mt-3 max-w-prose text-lg">{t("citiesBody")}</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
        <h2 className="font-script text-gold text-5xl sm:text-6xl">{t("finalTitle")}</h2>
        <p className="mt-3 text-lg">{t("finalBody")}</p>
        <ButtonLink href="/inscription" size="lg" className="mt-6">
          {t("heroCtaPrimary")}
        </ButtonLink>
      </section>
    </>
  );
}
