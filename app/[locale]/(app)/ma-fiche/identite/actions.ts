"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth/user";
import {
  correctionSchema,
  genderChangeSchema,
  placeChangeSchema,
  pseudoChangeSchema,
} from "@/lib/validation/identity";

/**
 * « Mon identité » (10e). Each field is saved on its own, under the member's session: the rules
 * are in Postgres (column grants, profiles_before_write, constraints, functions); Zod checks the
 * input first, with the rules of the sign-up.
 */
export type IdentityState =
  | { status: "idle" }
  | { status: "done" }
  | { status: "error"; error: string; until?: string }
  | { status: "confirm"; zone: string | null };

const fail = (error: string, until?: string): IdentityState => ({ status: "error", error, until });

function done(): IdentityState {
  revalidatePath("/[locale]/ma-fiche", "page");
  revalidatePath("/[locale]/ma-fiche/identite", "page");
  return { status: "done" };
}

export async function changePseudoAction(
  _s: IdentityState,
  form: FormData,
): Promise<IdentityState> {
  const parsed = pseudoChangeSchema.safeParse({ pseudo: form.get("pseudo") ?? undefined });
  if (!parsed.success) return fail("pseudoInvalid");
  const member = await requireMember();
  const { error } = await member.supabase
    .from("profiles")
    .update({ pseudo: parsed.data.pseudo })
    .eq("id", member.userId);
  if (error) {
    if (error.code === "23505") return fail("pseudoTaken");
    if (error.message.includes("pseudo_too_soon")) return fail("pseudoTooSoon", error.details);
    if (error.message.includes("pseudo_contains_contacts")) return fail("pseudoContacts");
    if (error.code === "23514") return fail("pseudoInvalid");
    return fail("generic");
  }
  return done();
}

export async function changeGenderAction(
  _s: IdentityState,
  form: FormData,
): Promise<IdentityState> {
  const parsed = genderChangeSchema.safeParse({ gender: form.get("gender") ?? undefined });
  if (!parsed.success) return fail("genderRequired");
  const member = await requireMember();
  const { error } = await member.supabase
    .from("profiles")
    .update({ gender: parsed.data.gender })
    .eq("id", member.userId);
  if (error) return fail("generic");
  // The colour of the whole interface follows the gender (PARCOURS-DESIGN §1).
  revalidatePath("/[locale]", "layout");
  return done();
}

export async function changePlaceAction(_s: IdentityState, form: FormData): Promise<IdentityState> {
  const parsed = placeChangeSchema.safeParse({
    placeId: form.get("placeId") ?? undefined,
    confirm: form.get("confirm") || undefined,
  });
  if (!parsed.success) return fail("cityRequired");
  const member = await requireMember();
  // Told before saving when the new town's quartier is not open (or there is none yet).
  if (!parsed.data.confirm) {
    const { data, error } = await member.supabase.rpc("place_zone", {
      p_place: parsed.data.placeId,
    });
    if (error) return fail("cityRequired");
    const zone = data?.[0];
    if (!zone?.open) return { status: "confirm", zone: zone?.zone_name ?? null };
  }
  const { error } = await member.supabase
    .from("profiles")
    .update({ place_id: parsed.data.placeId })
    .eq("id", member.userId);
  if (error) return fail(error.code === "23503" ? "cityRequired" : "generic");
  revalidatePath("/[locale]", "layout");
  return done();
}

export async function requestCorrectionAction(
  _s: IdentityState,
  form: FormData,
): Promise<IdentityState> {
  const parsed = correctionSchema.safeParse({
    birthdate: form.get("birthdate") ?? undefined,
    reason: form.get("reason") ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(issue?.path[0] === "reason" ? "reasonInvalid" : (issue?.message ?? "invalidDate"));
  }
  const member = await requireMember();
  const { error } = await member.supabase.rpc("request_birthdate_correction", {
    p_birthdate: parsed.data.birthdate,
    p_reason: parsed.data.reason,
  });
  if (error) {
    for (const key of ["underage", "same_birthdate", "invalid_reason", "correction_pending"]) {
      if (error.message.includes(key)) return fail(key);
    }
    if (error.message.includes("invalid_birthdate")) return fail("invalidDate");
    return fail("generic");
  }
  return done();
}
