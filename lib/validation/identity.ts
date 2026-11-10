import * as z from "zod/mini";
import { ageStepSchema, identityStepSchema } from "./onboarding";

/**
 * « Mon identité » (10e): the same rules as the sign-up (lib/validation/onboarding.ts), field by
 * field; the database checks them again (profiles_before_write, constraints, functions).
 */
export const pseudoChangeSchema = z.object({ pseudo: identityStepSchema.shape.pseudo });

export const genderChangeSchema = z.object({ gender: identityStepSchema.shape.gender });

export const placeChangeSchema = z.object({
  placeId: identityStepSchema.shape.placeId,
  /** « Enregistrer quand même », once told the new quartier is not open. */
  confirm: z.optional(z.literal("1")),
});

export const REASON_MIN = 3;
export const REASON_MAX = 200;

export const correctionSchema = z.object({
  birthdate: ageStepSchema.shape.birthdate,
  reason: z
    .string("reasonInvalid")
    .check(
      z.trim(),
      z.minLength(REASON_MIN, "reasonInvalid"),
      z.maxLength(REASON_MAX, "reasonInvalid"),
    ),
});

export const decisionSchema = z.object({
  correction: z.coerce.number().check(z.int(), z.positive()),
  decision: z.enum(["accept", "refuse"]),
  reason: z.optional(z.string().check(z.trim(), z.maxLength(300))),
});
