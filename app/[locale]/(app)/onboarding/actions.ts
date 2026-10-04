"use server";

import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { PhotoError, processPhoto } from "@/lib/image/process";
import { truncateIp } from "@/lib/net/ip";
import {
  CONSENT_VERSIONS,
  lastStep,
  parseRole,
  ROLE_STEP,
  stepNumber,
  stepPath,
  type Role,
} from "@/lib/onboarding/config";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import {
  ageStepSchema,
  firstErrors,
  identityStepSchema,
  motiveStepSchema,
  roleStepSchema,
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

type Member = Awaited<ReturnType<typeof requireMember>>;

async function progress(member: Member): Promise<{ step: number; role: Role | null }> {
  const { data } = await member.supabase
    .from("profiles")
    .select("onboarding_step, role")
    .eq("id", member.userId)
    .maybeSingle();
  return { step: data?.onboarding_step ?? 0, role: parseRole(data?.role) };
}

async function currentStep(member: Member): Promise<number> {
  return (await progress(member)).step;
}

/** Ends the onboarding (checks in SQL) and sends the member to their zone page or their Fiche. */
async function finishOnboarding(member: Member): Promise<StepState> {
  const { error } = await member.supabase.rpc("complete_onboarding");
  if (error) return failMessage("generic");
  return goTo(await destinationAfterOnboarding(member));
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
  return goTo(stepPath(ROLE_STEP));
}

/** Step 3, "Ton rôle" (SPEC v7 §2 bis): the role column is protected, only this function writes it. */
export async function saveRoleStep(_state: StepState, form: FormData): Promise<StepState> {
  const parsed = roleStepSchema.safeParse({ role: form.get("role") ?? undefined });
  if (!parsed.success) return fail(firstErrors(parsed.error));
  const member = await requireMember();
  const before = await progress(member);
  const { error } = await member.supabase.rpc("set_onboarding_role", { p_role: parsed.data.role });
  if (error) return failMessage("generic");
  // Changing the role changes the steps that follow: they must all be done (again) in order.
  if (before.role && before.role !== parsed.data.role && before.step > ROLE_STEP) {
    await member.supabase
      .from("profiles")
      .update({ onboarding_step: ROLE_STEP })
      .eq("id", member.userId);
  }
  return goTo(stepPath(ROLE_STEP + 1));
}

/** Visitor's « Entraîne-toi » (LANDING-DESIGN.md §2.1): the answer is never stored, only the step. */
export async function savePracticeStep(): Promise<StepState> {
  const member = await requireMember();
  const { step, role } = await progress(member);
  if (role !== "visitor") return failMessage("generic");
  const practiceStep = stepNumber(role, "practice");
  const { error } = await member.supabase
    .from("profiles")
    .update({ onboarding_step: Math.max(step, practiceStep) })
    .eq("id", member.userId);
  if (error) return failMessage("generic");
  return goTo(stepPath(practiceStep + 1));
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
  const { step, role } = await progress(member);
  if (!role) return goTo(stepPath(ROLE_STEP));
  const seekingStep = stepNumber(role, "seeking");
  if (!(await recordConsents(member.userId, ["art9_seeking"]))) return failMessage("configuration");
  const { error } = await member.supabase
    .from("profiles")
    .update({
      seeking_genders: parsed.data.genders,
      seek_age_min: parsed.data.ageMin,
      seek_age_max: parsed.data.ageMax,
      onboarding_step: Math.max(step, seekingStep),
    })
    .eq("id", member.userId);
  if (error) return failMessage("generic");
  return goTo(stepPath(seekingStep + 1));
}

/** Where a member lands once onboarding is done: their zone's waitlist page or their Fiche/Permis. */
async function destinationAfterOnboarding(member: Member) {
  const { data } = await member.supabase.rpc("zone_progress");
  const zone = data?.[0];
  const open = zone && (zone.launch_mode === "open" || zone.status === "open");
  return open ? "/ma-fiche" : "/quartier";
}

const PHOTO_ERRORS: Record<PhotoError["reason"], string> = {
  too_large: "photoTooLarge",
  unreadable: "photoUnreadable",
  too_small: "photoTooSmall",
  cannot_compress: "photoTooLarge",
};

/**
 * Stores a photo in the private pending bucket after server-side re-encoding (no metadata).
 * During the onboarding, the main photo (position 0) moves to the next step, or finishes the
 * onboarding when it is the role's last step (Bad, Phase 2b).
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

  if (form.get("onboarding") === "1") {
    const { step, role } = await progress(member);
    if (!role) return goTo(stepPath(ROLE_STEP));
    const photoStep = stepNumber(role, "photo");
    await member.supabase
      .from("profiles")
      .update({ onboarding_step: Math.max(step, photoStep) })
      .eq("id", member.userId);
    if (photoStep === lastStep(role)) return finishOnboarding(member);
    return goTo(stepPath(photoStep + 1));
  }
  return { status: "done" };
}

/** Visitor's last step in Phase 2b: the Motif de visite (masked and keyword-checked in SQL). */
export async function saveMotiveStep(_state: StepState, form: FormData): Promise<StepState> {
  const parsed = motiveStepSchema.safeParse({ motive: form.get("motive") ?? undefined });
  if (!parsed.success) return fail(firstErrors(parsed.error));
  const member = await requireMember();
  const { step, role } = await progress(member);
  if (role !== "visitor") return failMessage("generic");
  const motiveStep = stepNumber(role, "motive");
  const { error } = await member.supabase
    .from("profiles")
    .update({ visit_motive: parsed.data.motive, onboarding_step: Math.max(step, motiveStep) })
    .eq("id", member.userId);
  if (error) return failMessage("generic");
  if (motiveStep === lastStep(role)) return finishOnboarding(member);
  return goTo(stepPath(motiveStep + 1));
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
