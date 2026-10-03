"use server";

import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { PhotoError, processPhoto } from "@/lib/image/process";
import { truncateIp } from "@/lib/net/ip";
import { CONSENT_VERSIONS, ONBOARDING_STEPS, stepPath } from "@/lib/onboarding/config";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import {
  ageStepSchema,
  firstErrors,
  identityStepSchema,
  seekingStepSchema,
} from "@/lib/validation/onboarding";

type ConsentType = Database["public"]["Enums"]["consent_type"];
type FieldErrors = Partial<Record<string, string>>;
export type StepState =
  | { status: "idle" }
  | { status: "done" }
  | { status: "error"; fields?: FieldErrors; message?: "generic" | "configuration" };

const fail = (fields: FieldErrors): StepState => ({ status: "error", fields });
const failMessage = (message: "generic" | "configuration"): StepState => ({
  status: "error",
  message,
});

async function goTo(href: string): Promise<never> {
  return redirect({ href, locale: await getLocale() });
}

/** Consents are written with the secret key: only the server knows the real client IP. */
async function recordConsents(userId: string, types: ConsentType[]): Promise<boolean> {
  if (!process.env.SUPABASE_SECRET_KEY) return false;
  const ip = truncateIp((await headers()).get("x-forwarded-for"));
  const { error } = await createAdminClient()
    .from("consents")
    .insert(
      types.map((type) => ({
        user_id: userId,
        type,
        text_version: CONSENT_VERSIONS[type],
        granted: true,
        ip_truncated: ip,
      })),
    );
  return !error;
}

async function currentStep(member: Awaited<ReturnType<typeof requireMember>>): Promise<number> {
  const { data } = await member.supabase
    .from("profiles")
    .select("onboarding_step")
    .eq("id", member.userId)
    .maybeSingle();
  return data?.onboarding_step ?? 0;
}

export async function saveAgeStep(_state: StepState, form: FormData): Promise<StepState> {
  const parsed = ageStepSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(firstErrors(parsed.error));
  const member = await requireMember();
  const step = await currentStep(member);

  // insert or update, not upsert: PostgREST's upsert also rewrites "id", which members may not update.
  const { data: existing } = await member.supabase
    .from("profiles")
    .select("id")
    .eq("id", member.userId)
    .maybeSingle();
  const { error } = existing
    ? await member.supabase
        .from("profiles")
        .update({ birthdate: parsed.data.birthdate })
        .eq("id", member.userId)
    : await member.supabase
        .from("profiles")
        .insert({ id: member.userId, birthdate: parsed.data.birthdate });
  if (error) {
    if (error.message.includes("underage")) return fail({ birthdate: "underage" });
    if (error.message.includes("birthdate_locked")) return fail({ birthdate: "invalidDate" });
    return failMessage("generic");
  }
  if (!(await recordConsents(member.userId, ["age_18", "terms", "privacy"]))) {
    return failMessage("configuration");
  }
  const ref = member.metadata.ref;
  if (typeof ref === "string" && ref.length > 0) {
    await member.supabase.rpc("claim_referral", { p_code: ref });
  }
  await member.supabase
    .from("profiles")
    .update({ onboarding_step: Math.max(step, 1) })
    .eq("id", member.userId);
  return goTo(stepPath(2));
}

export async function saveIdentityStep(_state: StepState, form: FormData): Promise<StepState> {
  const parsed = identityStepSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(firstErrors(parsed.error));
  const member = await requireMember();
  const step = await currentStep(member);
  const { error } = await member.supabase
    .from("profiles")
    .update({
      pseudo: parsed.data.pseudo,
      gender: parsed.data.gender,
      place_id: parsed.data.placeId,
      onboarding_step: Math.max(step, 2),
    })
    .eq("id", member.userId);
  if (error) {
    if (error.code === "23505") return fail({ pseudo: "pseudoTaken" });
    if (error.message.includes("pseudo") || error.code === "23514")
      return fail({ pseudo: "pseudoInvalid" });
    if (error.code === "23503") return fail({ placeId: "cityRequired" });
    return failMessage("generic");
  }
  return goTo(stepPath(3));
}

export async function saveSeekingStep(_state: StepState, form: FormData): Promise<StepState> {
  const parsed = seekingStepSchema.safeParse({
    genders: form.getAll("genders"),
    ageMin: form.get("ageMin"),
    ageMax: form.get("ageMax"),
    consent: form.get("consent") ?? undefined,
  });
  if (!parsed.success) return fail(firstErrors(parsed.error));
  const member = await requireMember();
  const step = await currentStep(member);
  if (!(await recordConsents(member.userId, ["art9_seeking"]))) return failMessage("configuration");
  const { error } = await member.supabase
    .from("profiles")
    .update({
      seeking_genders: parsed.data.genders,
      seek_age_min: parsed.data.ageMin,
      seek_age_max: parsed.data.ageMax,
      onboarding_step: Math.max(step, 3),
    })
    .eq("id", member.userId);
  if (error) return failMessage("generic");
  return goTo(stepPath(4));
}

/** Where a member lands once onboarding is done: their city's waitlist page or their Fiche. */
async function destinationAfterOnboarding(member: Awaited<ReturnType<typeof requireMember>>) {
  const { data } = await member.supabase.rpc("zone_progress");
  const zone = data?.[0];
  const open = zone && (zone.launch_mode === "open" || zone.status === "open");
  return open ? "/ma-fiche" : "/ville-bientot";
}

const PHOTO_ERRORS: Record<PhotoError["reason"], string> = {
  too_large: "photoTooLarge",
  unreadable: "photoUnreadable",
  too_small: "photoTooSmall",
  cannot_compress: "photoTooLarge",
};

/**
 * Stores a photo in the private pending bucket after server-side re-encoding (no metadata).
 * The main photo (position 0) of the onboarding also finishes the onboarding.
 */
export async function uploadPhotoAction(_state: StepState, form: FormData): Promise<StepState> {
  const file = form.get("photo");
  const position = Number(form.get("position") ?? 0);
  if (!(file instanceof File) || file.size === 0) return fail({ photo: "photoRequired" });
  if (!Number.isInteger(position) || position < 0 || position > 5) return failMessage("generic");

  let processed: Awaited<ReturnType<typeof processPhoto>>;
  try {
    processed = await processPhoto(Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    return fail({
      photo: error instanceof PhotoError ? PHOTO_ERRORS[error.reason] : "photoUnreadable",
    });
  }

  const member = await requireMember();
  const bucket = member.supabase.storage.from("photos-pending");
  const base = `${member.userId}/${crypto.randomUUID()}`;
  const options = { contentType: "image/webp", cacheControl: "31536000", upsert: false };
  const uploads = await Promise.all([
    bucket.upload(`${base}.webp`, processed.large, options),
    bucket.upload(`${base}-s.webp`, processed.small, options),
  ]);
  if (uploads.some((result) => result.error)) return failMessage("generic");

  // Replacing the photo at this position: drop the previous files and row first.
  const { data: previous } = await member.supabase
    .from("photos")
    .select("id, pending_path")
    .eq("owner_id", member.userId)
    .eq("position", position)
    .maybeSingle();
  if (previous) {
    if (previous.pending_path) {
      await bucket.remove([
        previous.pending_path,
        previous.pending_path.replace(/\.webp$/, "-s.webp"),
      ]);
    }
    await member.supabase.from("photos").delete().eq("id", previous.id);
  }
  const { error } = await member.supabase.from("photos").insert({
    owner_id: member.userId,
    position,
    pending_path: `${base}.webp`,
    width: processed.width,
    height: processed.height,
  });
  if (error) {
    await bucket.remove([`${base}.webp`, `${base}-s.webp`]);
    return failMessage("generic");
  }

  if (form.get("finish") === "1") {
    const step = await currentStep(member);
    await member.supabase
      .from("profiles")
      .update({ onboarding_step: Math.max(step, ONBOARDING_STEPS) })
      .eq("id", member.userId);
    const { error: completeError } = await member.supabase.rpc("complete_onboarding");
    if (completeError) return failMessage("generic");
    return goTo(await destinationAfterOnboarding(member));
  }
  return { status: "done" };
}

export type PlaceOption = { id: number; name: string; postalCode: string };

export async function searchPlacesAction(query: string): Promise<PlaceOption[]> {
  const q = query.trim();
  if (q.length < 2 || q.length > 60) return [];
  const member = await requireMember();
  const { data } = await member.supabase.rpc("search_places", { p_query: q, p_limit: 8 });
  return (data ?? []).map((place) => ({
    id: place.id,
    name: place.name,
    postalCode: place.postal_codes[0] ?? "",
  }));
}
