import { Phone } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use, type ReactNode } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { cn } from "@/lib/cn";
import { indexableMetadata } from "@/lib/seo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return indexableMetadata(locale, "/");
}

type Step = { title: string; body: string };
type ConsentGroup = { title: string; points: string[] };
type Door = "bad" | "visitor";

/** Height-chart marks shown on both sides of the hero (decorative, LANDING-DESIGN.md §1.2). */
const TOISE_MARKS = [200, 190, 180, 170, 160, 150, 140, 130, 120, 110, 100, 90];

function Toise() {
  return (
    <div aria-hidden="true" className="landing-toise pointer-events-none absolute inset-0">
      {(["left-2", "right-2"] as const).map((side) => (
        <div
          key={side}
          className={cn(
            "font-display absolute top-8 flex flex-col gap-[1.625rem] text-[11px] text-[#3e3e44]",
            side,
          )}
        >
          {TOISE_MARKS.map((mark) => (
            <span key={mark}>{mark}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Speaker grille of a visiting-room window (hygiaphone). */
function Hygiaphone() {
  const holes = [
    [31, 31],
    [31, 21],
    [31, 41],
    [21, 31],
    [41, 31],
    [24, 24],
    [38, 24],
    [24, 38],
    [38, 38],
    [31, 12],
    [31, 50],
    [12, 31],
    [50, 31],
    [18, 18],
    [44, 18],
    [18, 44],
    [44, 44],
  ];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 62 62"
      className="absolute top-8 left-1/2 size-[62px] -translate-x-1/2 opacity-85"
    >
      <circle
        cx="31"
        cy="31"
        r="29"
        fill="none"
        stroke="#F2E8D5"
        strokeOpacity=".35"
        strokeWidth="2"
      />
      <g fill="#F2E8D5" fillOpacity=".45">
        {holes.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.2" />
        ))}
      </g>
    </svg>
  );
}

function DoorLink({
  door,
  label,
  title,
  hint,
}: {
  door: Door;
  label: string;
  title: string;
  hint: string;
}) {
  const bad = door === "bad";
  return (
    <LocalizedLink
      href={`/inscription?role=${door}`}
      className={cn(
        "relative flex min-h-[190px] flex-col items-center justify-end gap-1.5 overflow-hidden rounded-t-md rounded-b-sm border-[3px] bg-[#121214] px-2.5 py-3.5 text-center no-underline transition-shadow",
        // PARCOURS-DESIGN §1: colours are for gender, never for the role: both doors are cream.
        "border-cream shadow-[0_0_16px_rgb(242_232_213/0.25)] hover:shadow-[0_0_26px_rgb(242_232_213/0.45)]",
        bad ? "door-cell" : "door-glass",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "font-stamp absolute inset-x-0 top-2.5 text-[11px] tracking-[0.18em] uppercase",
          "text-cream",
        )}
      >
        {label}
      </span>
      {bad ? null : (
        <>
          <Hygiaphone />
          <Phone aria-hidden="true" className="text-cream absolute top-9 right-2.5 size-6" />
        </>
      )}
      <span
        className={cn(
          "font-display relative text-2xl leading-none uppercase",
          "neon-cream text-cream",
        )}
      >
        {title}
      </span>
      <span className="text-cream relative text-xs leading-snug font-semibold">{hint}</span>
    </LocalizedLink>
  );
}

function Kicker({ children, className }: { children: ReactNode; className: string }) {
  return (
    <p className={cn("font-stamp text-xs tracking-[0.25em] uppercase", className)}>
      <span aria-hidden="true">— </span>
      {children}
      <span aria-hidden="true"> —</span>
    </p>
  );
}

export default function LandingPage({ params }: Props) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Landing");
  const stepsBad = t.raw("steps_bad") as Step[];
  const stepsVisitor = t.raw("steps_visitor") as Step[];
  const consentGroups = t.raw("consentGroups") as ConsentGroup[];
  const charterPoints = t.raw("charterPoints") as string[];
  const ticker = t.raw("ticker") as string[];

  return (
    <div className="overflow-x-clip text-center">
      {/* Hero: neon sign, transparent 3D logo, title, the two doors (LANDING-DESIGN.md §1.1–1.3). */}
      <section className="relative px-6 pt-9 pb-10">
        <Toise />
        <div className="relative mx-auto flex max-w-xl flex-col items-center gap-5">
          <p className="neon-sign font-display rounded-lg border-2 border-[#ff3355] px-3.5 py-1.5 text-[15px] tracking-[0.33em] text-[#ffd1d8] uppercase">
            {t("sign")}
          </p>
          {/* Plain <img>: pre-optimised AVIF (scripts/build-brand-assets.mjs); next/image would add
              a client component to the landing (SPEC §18 JS budget). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-3d-t-560.avif"
            srcSet="/brand/logo-3d-t-360.avif 360w, /brand/logo-3d-t-560.avif 560w, /brand/logo-3d-t-840.avif 840w"
            sizes="(min-width: 768px) 22rem, 17.5rem"
            alt={t("logoAlt")}
            width={560}
            height={523}
            fetchPriority="high"
            decoding="async"
            className="h-auto w-[17.5rem] md:w-[22rem]"
          />
          <h1 className="font-display max-w-[21rem] text-[2.875rem] leading-[1.04] tracking-wide uppercase sm:max-w-xl sm:text-6xl">
            {t.rich("heroTitle", {
              glow: (chunks) => <span className="neon-gold text-[#f4d27a]">{chunks}</span>,
            })}
          </h1>
          <p className="max-w-[20rem] text-base leading-relaxed text-[#e6dcc8] sm:max-w-lg sm:text-lg">
            {t("heroLead")}
          </p>
          <div className="grid w-full max-w-lg grid-cols-2 gap-3">
            {(["bad", "visitor"] as const).map((door) => (
              <DoorLink
                key={door}
                door={door}
                label={t(`doorLabel_${door}`)}
                title={t(`door_${door}`)}
                hint={t(`doorHint_${door}`)}
              />
            ))}
          </div>
          <LocalizedLink
            href="/connexion"
            className="text-cream inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
          >
            {t("heroCtaLogin")}
          </LocalizedLink>
        </div>
      </section>

      {/* Red ticker (decorative: the same phrases are on the page as text). */}
      <div
        aria-hidden="true"
        className="bg-red-bright text-ink overflow-hidden py-2.5 shadow-[0_0_24px_rgb(224_35_63/0.45)]"
      >
        <div className="landing-marquee font-display flex w-max gap-7 text-lg tracking-[0.1em] whitespace-nowrap uppercase">
          {[0, 1].map((copy) =>
            ticker.map((phrase) => <span key={`${copy}-${phrase}`}>{phrase} ★</span>),
          )}
        </div>
      </div>

      <section aria-labelledby="steps-title" className="px-6 pt-11">
        <h2 id="steps-title" className="font-display text-grey text-xl tracking-wide uppercase">
          {t("stepsTitle")}
        </h2>

        {/* Bad side: three exhibits on cream paper with a strip of gold tape. */}
        <section
          aria-labelledby="steps-bad"
          className="mx-auto mt-8 flex max-w-5xl flex-col items-center gap-4"
        >
          <Kicker className="text-cream">{t("sideKicker_bad")}</Kicker>
          <h3 id="steps-bad" className="neon-cream font-display text-cream -mt-2 text-4xl uppercase">
            {t("stepsTitle_bad")}
          </h3>
          <ol className="grid w-full gap-6 pt-2 lg:grid-cols-3">
            {stepsBad.map((step, index) => (
              <li
                key={step.title}
                className="text-ink bg-cream relative rounded-sm px-4.5 pt-5.5 pb-4.5"
              >
                <span
                  aria-hidden="true"
                  className="absolute -top-2.5 left-1/2 h-5 w-[70px] -translate-x-1/2 bg-[rgb(154_145_134/0.7)]"
                />
                <p className="font-stamp text-grey-ink mb-1.5 text-xs tracking-[0.18em] uppercase">
                  {t("pieceLabel", { number: index + 1 })}
                </p>
                <h4 className="font-display mb-2 text-2xl uppercase">{step.title}</h4>
                <p className="text-[15px] leading-normal">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Visitor side: dark cards with a neon number. */}
        <section
          aria-labelledby="steps-visitor"
          className="mx-auto mt-11 flex max-w-5xl flex-col items-center gap-4"
        >
          <Kicker className="text-cream">{t("sideKicker_visitor")}</Kicker>
          <h3
            id="steps-visitor"
            className="neon-cream font-display text-cream -mt-2 text-4xl uppercase"
          >
            {t("stepsTitle_visitor")}
          </h3>
          <ol className="grid w-full gap-4 lg:grid-cols-3">
            {stepsVisitor.map((step, index) => (
              <li
                key={step.title}
                className="border-line flex flex-col items-center gap-2 rounded-md border bg-[#121214] px-4.5 py-5 shadow-[0_0_14px_rgb(242_232_213/0.08)]"
              >
                <span
                  aria-hidden="true"
                  className="neon-cream font-display text-cream text-[2.5rem] leading-none"
                >
                  {index + 1}
                </span>
                <h4 className="font-display text-[22px] uppercase">{step.title}</h4>
                <p className="text-[15px] leading-normal text-[#e6dcc8]">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </section>

      {/* La Promenade: 21:00 in glowing gold. */}
      <section
        aria-labelledby="promenade-title"
        className="border-gold mx-6 mt-11 flex flex-col items-center gap-2.5 rounded-[10px] border bg-[#121214] px-4.5 py-6 shadow-[0_0_18px_rgb(212_164_55/0.25)] sm:mx-auto sm:max-w-xl"
      >
        <span
          aria-hidden="true"
          className="neon-gold font-display text-[2.5rem] leading-none text-[#f4d27a]"
        >
          {t("promenadeTime")}
        </span>
        <h2 id="promenade-title" className="font-display text-[28px] uppercase">
          {t("promenadeTitle")}
        </h2>
        <p className="text-[15px] leading-normal text-[#e6dcc8]">{t("promenadeBody")}</p>
      </section>

      {/* Consent: three centred blocks separated by a rule. */}
      <section
        aria-labelledby="consent-title"
        className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 pt-11"
      >
        <h2 id="consent-title" className="font-display text-[30px] leading-[1.1] uppercase">
          {t("consentTitle")}
        </h2>
        <p className="text-[15px] leading-normal text-[#e6dcc8]">{t("consentBody")}</p>
        <div className="divide-line flex w-full flex-col divide-y">
          {consentGroups.map((group) => (
            <div key={group.title} className="py-3.5">
              <h3
                className={cn(
                  "font-stamp mb-1 text-xs tracking-[0.18em] uppercase",
                  "text-cream",
                )}
              >
                {group.title}
              </h3>
              {group.points.map((point) => (
                <p key={point} className="text-[15px] leading-normal">
                  {point}
                </p>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Bads first (kept from LANDING-COPY.md). */}
      <section
        aria-labelledby="quarters-title"
        className="mx-auto flex max-w-xl flex-col items-center gap-2 px-6 pt-11"
      >
        <h2 id="quarters-title" className="font-display text-gold text-[26px] uppercase">
          {t("quartersTitle")}
        </h2>
        <p className="text-[15px] leading-normal text-[#e6dcc8]">{t("quartersBody")}</p>
      </section>

      {/* Charter. */}
      <section
        aria-labelledby="charter-title"
        className="mx-auto flex max-w-xl flex-col items-center gap-2 px-6 pt-11"
      >
        <h2 id="charter-title" className="font-display text-red-bright text-[26px] uppercase">
          {t("charterTitle")}
        </h2>
        <p className="text-[15px] text-[#e6dcc8]">{t("charterLead")}</p>
        <ul className="text-[15px] leading-[1.7] text-[#e6dcc8]">
          {charterPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <LocalizedLink
          href="/charte"
          className="text-cream hover:text-gold inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4"
        >
          {t("charterLink")}
        </LocalizedLink>
      </section>

      {/* Final call: two full-width buttons. */}
      <section className="border-line mt-9 border-t bg-[#121214] px-6 pt-10 pb-12">
        <div className="mx-auto flex max-w-md flex-col items-center gap-4">
          <h2 className="neon-red font-script text-[2.75rem] text-[#ffd1d8]">{t("finalTitle")}</h2>
          <p className="text-[15px] text-[#e6dcc8]">{t("finalBody")}</p>
          <div className="flex w-full flex-col gap-2.5">
            <LocalizedLink
              href="/inscription?role=bad"
              className="bg-cream text-ink font-display flex min-h-[52px] items-center justify-center rounded text-xl uppercase no-underline shadow-[0_0_18px_rgb(242_232_213/0.3)]"
            >
              {t("finalCta_bad")}
            </LocalizedLink>
            <LocalizedLink
              href="/inscription?role=visitor"
              className="border-cream font-display text-cream flex min-h-[52px] items-center justify-center rounded border-2 text-xl uppercase no-underline shadow-[0_0_18px_rgb(242_232_213/0.2)]"
            >
              {t("finalCta_visitor")}
            </LocalizedLink>
          </div>
        </div>
      </section>
    </div>
  );
}
