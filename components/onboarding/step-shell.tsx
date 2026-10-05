import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { lastStep, type Role, type StepKind } from "@/lib/onboarding/config";

type Props = {
  step: number;
  role: Role;
  kind: StepKind;
  children: ReactNode;
  /** Steps with their own heading (L'Interrogatoire: the question itself). */
  heading?: string;
  kicker?: string;
  aside?: string;
};

// Steps whose heading is centred under a kicker (maquettes PARCOURS-DESIGN §6).
const CENTRED: readonly StepKind[] = [
  "practice",
  "poses",
  "casier",
  "casierCheck",
  "interrogation",
];

/** Frame of an onboarding step: Le Dossier (Bad) or Le Permis de visite (Visitor), SPEC v7 §4. */
export async function StepShell({ step, role, kind, children, heading, kicker, aside }: Props) {
  const t = await getTranslations("Onboarding");
  const total = lastStep(role);
  const percent = Math.round((step / total) * 100);
  const progress = t("progress", { current: step, total });
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="text-accent text-sm font-bold tracking-[0.2em] uppercase">
        {t(`title_${role}`)}
      </p>
      <div className="text-grey mt-3 flex items-center justify-between gap-3 text-sm">
        <span>{progress}</span>
        {aside ? <span>{aside}</span> : null}
      </div>
      <div
        role="progressbar"
        aria-label={t(`title_${role}`)}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={step}
        aria-valuetext={progress}
        className="bg-ink-3 mt-2 h-2 overflow-hidden rounded-full"
      >
        <div className="bg-accent h-full rounded-full" style={{ width: `${percent}%` }} />
      </div>
      {CENTRED.includes(kind) ? (
        <p className="text-accent font-stamp mt-6 text-center text-sm tracking-[0.25em] uppercase">
          {kicker ?? t(`kickers.${kind}`)}
        </p>
      ) : null}
      <h1
        className={
          CENTRED.includes(kind)
            ? "font-display mt-2 text-center text-4xl tracking-wide uppercase"
            : "font-display mt-6 text-4xl tracking-wide uppercase"
        }
      >
        {heading ?? (kind === "seeking" ? t(`steps.seeking_${role}`) : t(`steps.${kind}`))}
      </h1>
      <div className="mt-6">{children}</div>
      <p className="text-grey mt-8 text-sm">{t("savedNotice")}</p>
      <p className="text-grey text-sm">{t(`deletionNotice_${role}`)}</p>
    </div>
  );
}
