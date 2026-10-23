"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { CHARGE_MAX, duplicateIndexes, shuffleCharges } from "@/lib/casier";
import { answerSchema, acceptedForStorage } from "@/lib/interrogation";
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
  // The gender sets the colour of the whole interface (layout, PARCOURS-DESIGN §1).
  revalidatePath("/[locale]", "layout");
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
  // The role tag « BAD » / « VISITEUR » is in the layout's header.
  revalidatePath("/[locale]", "layout");
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
    // The 3 poses and the photo of the Permis arrive cut out by the browser; otherwise they wait
    // for the Greffe's cut-out (photos.needs_cutout, set by the database at the insert).
    processed = await processPhoto(Buffer.from(await file.arrayBuffer()), {
      keepCutout: position <= 2,
    });
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
  const { data: inserted, error } = await member.supabase
    .from("photos")
    .insert({
      owner_id: member.userId,
      position,
      pending_path: `${base}.webp`,
      width: processed.width,
      height: processed.height,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    await bucket.remove([`${base}.webp`, `${base}-s.webp`]);
    return failMessage("generic");
  }
  // Cut out or not is the server's finding on the file, never the member's say (secret key).
  if (processed.cutout) {
    const { error: flagError } = await createAdminClient()
      .from("photos")
      .update({ is_cutout: true, needs_cutout: false })
      .eq("id", inserted.id);
    if (flagError) return failMessage("generic");
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

/**
 * L'Interrogatoire (SPEC v7.4 §9): saves one answer (own rows only, RLS; consistency checked in
 * SQL), then goes to the next question. During the onboarding, the last core answer ends it; from
 * Ma Fiche ("file"), it goes back to the list of questions.
 */
export async function saveAnswerAction(_state: StepState, form: FormData): Promise<StepState> {
  const parsed = answerSchema.safeParse({
    questionId: form.get("questionId"),
    optionId: form.get("optionId") ?? undefined,
    accepted: form.getAll("accepted"),
    importance: form.get("importance") ?? "important",
  });
  if (!parsed.success) return fail(firstErrors(parsed.error));
  const { questionId, optionId, accepted, importance } = parsed.data;
  const member = await requireMember();

  const { data: options } = await member.supabase
    .from("question_options")
    .select("id")
    .eq("question_id", questionId);
  const optionIds = (options ?? []).map((option) => option.id);
  if (!optionIds.includes(optionId) || accepted.some((id) => !optionIds.includes(id))) {
    return failMessage("generic");
  }
  const values = {
    option_id: optionId,
    accepted_option_ids: acceptedForStorage(accepted, optionIds),
    importance,
  };
  // insert or update, not upsert: members may not rewrite user_id / question_id.
  const { data: existing } = await member.supabase
    .from("answers")
    .select("question_id")
    .eq("user_id", member.userId)
    .eq("question_id", questionId)
    .maybeSingle();
  const { error } = existing
    ? await member.supabase
        .from("answers")
        .update(values)
        .eq("user_id", member.userId)
        .eq("question_id", questionId)
    : await member.supabase
        .from("answers")
        .insert({ user_id: member.userId, question_id: questionId, ...values });
  if (error) return failMessage("generic");

  if (form.get("context") !== "onboarding") return goTo("/interrogatoire");

  const { step, role } = await progress(member);
  if (!role) return goTo(stepPath(ROLE_STEP));
  const interrogationStep = stepNumber(role, "interrogation");
  const { data: core } = await member.supabase
    .from("questions")
    .select("id")
    .eq("phase", "core")
    .order("position");
  const { data: mine } = await member.supabase
    .from("answers")
    .select("question_id")
    .eq("user_id", member.userId);
  const answered = new Set((mine ?? []).map((row) => row.question_id));
  const ids = (core ?? []).map((question) => question.id);
  const next = ids.findIndex((id) => !answered.has(id));
  if (next >= 0) return goTo(`${stepPath(interrogationStep)}?q=${next + 1}`);
  await member.supabase
    .from("profiles")
    .update({ onboarding_step: Math.max(step, interrogationStep) })
    .eq("id", member.userId);
  return finishOnboarding(member);
}

/** Bad, step 5 « Passe à la toise » (PARCOURS-DESIGN §3): the 3 poses must all be uploaded. */
export async function savePosesStep(): Promise<StepState> {
  const member = await requireMember();
  const { step, role } = await progress(member);
  if (role !== "bad") return failMessage("generic");
  const { data: photos } = await member.supabase
    .from("photos")
    .select("position")
    .eq("owner_id", member.userId)
    .in("position", [0, 1, 2]);
  if (new Set((photos ?? []).map((photo) => photo.position)).size < 3) {
    return fail({ photo: "posesRequired" });
  }
  const posesStep = stepNumber(role, "poses");
  await member.supabase
    .from("profiles")
    .update({ onboarding_step: Math.max(step, posesStep) })
    .eq("id", member.userId);
  return goTo(stepPath(posesStep + 1));
}

/**
 * Bad, step 6 « Le Casier » (SPEC §6): the true line then two false ones, stored in a random order
 * for the Visitors (true_index is never sent to them). Masking, keywords and duplicates in SQL too.
 * From Ma Fiche ("file"), the same form edits the Casier.
 */
export async function saveCasierStep(_state: StepState, form: FormData): Promise<StepState> {
  const lines = [1, 2, 3].map((n) => String(form.get(`charge${n}`) ?? "").trim());
  const fields: FieldErrors = {};
  lines.forEach((line, index) => {
    if (line.length === 0) fields[`charge${index + 1}`] = "chargeRequired";
    else if (Array.from(line).length > CHARGE_MAX) fields[`charge${index + 1}`] = "chargeTooLong";
  });
  for (const index of duplicateIndexes(lines)) {
    fields[`charge${index + 1}`] ??= "chargesDuplicate";
  }
  if (Object.keys(fields).length > 0) return fail(fields);

  const member = await requireMember();
  const { step, role } = await progress(member);
  if (role !== "bad") return failMessage("generic");
  const [trueLine, ...falseLines] = lines as [string, string, string];
  const { charges, trueIndex } = shuffleCharges(trueLine, falseLines as [string, string], () => {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0]! / 2 ** 32;
  });
  const values = {
    charge_1: charges[0],
    charge_2: charges[1],
    charge_3: charges[2],
    true_index: trueIndex,
  };
  const { data: existing } = await member.supabase
    .from("casier_charges")
    .select("profile_id")
    .eq("profile_id", member.userId)
    .maybeSingle();
  const { error } = existing
    ? await member.supabase.from("casier_charges").update(values).eq("profile_id", member.userId)
    : await member.supabase.from("casier_charges").insert({ profile_id: member.userId, ...values });
  if (error) {
    if (error.message.includes("casier_duplicate_charges"))
      return fail({ charge1: "chargesDuplicate" });
    return failMessage("generic");
  }
  if (form.get("context") === "file") return goTo("/mon-casier/apercu");
  const casierStep = stepNumber(role, "casier");
  await member.supabase
    .from("profiles")
    .update({ onboarding_step: Math.max(step, casierStep) })
    .eq("id", member.userId);
  return goTo(stepPath(casierStep + 1));
}

/** Bad, step 7 « Teste ton Casier »: « Mon Casier est prêt » moves on to L'Interrogatoire. */
export async function confirmCasierStep(): Promise<StepState> {
  const member = await requireMember();
  const { step, role } = await progress(member);
  if (role !== "bad") return failMessage("generic");
  const { data: casier } = await member.supabase
    .from("casier_charges")
    .select("profile_id")
    .eq("profile_id", member.userId)
    .maybeSingle();
  const checkStep = stepNumber(role, "casierCheck");
  if (!casier) return goTo(stepPath(checkStep - 1));
  await member.supabase
    .from("profiles")
    .update({ onboarding_step: Math.max(step, checkStep) })
    .eq("id", member.userId);
  return goTo(stepPath(checkStep + 1));
}
