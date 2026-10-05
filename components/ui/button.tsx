import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "inline";

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full font-semibold tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

// Every text/background pair is ≥ 4.5:1 (see globals.css).
const variants: Record<Variant, string> = {
  primary: "bg-accent text-ink hover:bg-accent-hover",
  secondary: "border-2 border-cream/80 text-cream hover:bg-cream hover:text-ink",
  ghost: "text-cream underline-offset-4 hover:underline",
  danger: "bg-red-bright text-ink hover:bg-[#f45a71]",
};

const sizes: Record<Size, string> = {
  md: "px-5 py-2 text-base",
  lg: "px-7 py-3 text-lg",
  inline: "px-3 py-2 text-base",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

type ButtonProps = ComponentProps<"button"> & { variant?: Variant; size?: Size };

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...props} />;
}
