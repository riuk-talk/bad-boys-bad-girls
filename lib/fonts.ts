import { Anton, Inter_Tight, Special_Elite, Yellowtail } from "next/font/google";

// Self-hosted at build time by next/font (no request to Google at runtime).
export const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-anton",
});

export const interTight = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter-tight",
});

// Secondary faces: not preloaded to keep the landing LCP lean.
export const specialElite = Special_Elite({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-special-elite",
});

export const yellowtail = Yellowtail({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-yellowtail",
});

export const fontVariables = [
  anton.variable,
  interTight.variable,
  specialElite.variable,
  yellowtail.variable,
].join(" ");
