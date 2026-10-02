import * as z from "zod/mini";
import { Constants } from "@/lib/supabase/database.types";

/** Error messages are i18n keys under "Onboarding.errors". */
export type OnboardingErrorKey =
  | "required"
  | "underage"
  | "invalidDate"
  | "mustAccept"
  | "pseudoInvalid"
  | "cityRequired"
  | "gendersRequired"
  | "ageRange"
  | "consentRequired";

/** Age in full years on `today` (same rule as public.age_years). */
export function ageOn(birthdate: string, today = new Date()): number {
  const [y, m, d] = birthdate.split("-").map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  const beforeBirthday =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

const checked = z.literal("on", "mustAccept");

export const ageStepSchema = z.object({
  birthdate: z.string("required").check(
    z.minLength(1, "required"),
    z.refine(isRealDate, "invalidDate"),
    z.refine((value) => !isRealDate(value) || ageOn(value) <= 110, "invalidDate"),
    z.refine((value) => !isRealDate(value) || ageOn(value) >= 18, "underage"),
  ),
  attest: checked,
  terms: checked,
  privacy: checked,
});

export const PSEUDO_PATTERN = /^[\p{L}\p{N}_. -]{3,20}$/u;

export const identityStepSchema = z.object({
  pseudo: z
    .string("required")
    .check(z.trim(), z.minLength(1, "required"), z.regex(PSEUDO_PATTERN, "pseudoInvalid")),
  gender: z.enum(Constants.public.Enums.gender, "required"),
  placeId: z.coerce.number("cityRequired").check(z.int("cityRequired"), z.positive("cityRequired")),
});

export const seekingStepSchema = z
  .object({
    genders: z
      .array(z.enum(Constants.public.Enums.gender, "gendersRequired"))
      .check(z.minLength(1, "gendersRequired")),
    ageMin: z.coerce
      .number("ageRange")
      .check(z.int("ageRange"), z.gte(18, "ageRange"), z.lte(99, "ageRange")),
    ageMax: z.coerce
      .number("ageRange")
      .check(z.int("ageRange"), z.gte(18, "ageRange"), z.lte(99, "ageRange")),
    consent: z.literal("on", "consentRequired"),
  })
  .check(
    z.refine((value) => value.ageMin <= value.ageMax, { message: "ageRange", path: ["ageMax"] }),
  );

export function firstErrors(error: z.core.$ZodError): Partial<Record<string, OnboardingErrorKey>> {
  const result: Partial<Record<string, OnboardingErrorKey>> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (!result[field]) result[field] = issue.message as OnboardingErrorKey;
  }
  return result;
}
