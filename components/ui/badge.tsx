import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "gold" | "red" | "neutral";

const tones: Record<Tone, string> = {
  gold: "border-gold/60 bg-gold/10 text-gold",
  red: "border-red-bright/60 bg-red/10 text-red-bright",
  neutral: "border-line bg-ink-3 text-cream",
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold",
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
