import { clsx, type ClassValue } from "clsx";

/**
 * Joins class names. No tailwind-merge (≈9 kB of client JS, SPEC §18): components must not
 * receive a utility that conflicts with one they already set (e.g. a second display or padding).
 * Variants/sizes are props instead; `className` is for layout only (margin, width, position).
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
