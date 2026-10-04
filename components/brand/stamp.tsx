import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

export type StampKind =
  | "guilty"
  | "permanentPermit"
  | "dismissed"
  | "goodConduct"
  | "cleanRecord"
  | "permit"
  | "visitAccepted";

/** Trust and welcome stamps are gold; the others red (SPEC v7 §1 bis). */
const GOLD: readonly StampKind[] = [
  "goodConduct",
  "cleanRecord",
  "permit",
  "visitAccepted",
  "permanentPermit",
];

type StampProps = {
  kind: StampKind;
  /** "paper": on the cream Fiche; "dark": on the ink background. */
  surface?: "paper" | "dark";
  animated?: boolean;
  tilt?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizes = {
  sm: "text-sm px-3 py-1",
  md: "text-xl px-4 py-1.5",
  lg: "text-3xl px-6 py-2",
};

/**
 * Brand-only ink stamp (SPEC §1 bis): double outline, slightly irregular ink, tilted.
 * Never uses any real administration's insignia. Reduced motion → fade (globals.css).
 * The entry animation scales the stamp up: animated stamps need a parent with overflow-x clip.
 */
export function Stamp({
  kind,
  surface = "dark",
  animated = false,
  tilt = -8,
  size = "md",
  className,
}: StampProps) {
  const t = useTranslations("Components.stamps");
  const color = GOLD.includes(kind)
    ? surface === "paper"
      ? "text-gold-ink"
      : "text-gold"
    : surface === "paper"
      ? "text-red-ink"
      : "text-red-bright";
  const label = t(kind);

  return (
    <span
      role="img"
      aria-label={label}
      style={{ rotate: `${tilt}deg` }}
      className={cn(
        "font-stamp relative inline-flex items-center justify-center border-[3px] border-current leading-none tracking-[0.12em] uppercase select-none",
        "before:pointer-events-none before:absolute before:inset-[3px] before:border before:border-current before:content-['']",
        "[mask-image:radial-gradient(circle_at_30%_40%,#000_55%,rgb(0_0_0/0.82)_70%,#000_100%)]",
        "rounded-sm before:rounded-[1px]",
        surface === "paper" ? "mix-blend-multiply" : "",
        animated ? "animate-stamp" : "",
        color,
        sizes[size],
        className,
      )}
    >
      <span aria-hidden="true">{label}</span>
    </span>
  );
}
