"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod/mini";
import { requireMember } from "@/lib/auth/user";
import { VISIT_MOTIVE_MAX } from "@/lib/onboarding/config";

export type FicheState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: "tooManySigns" | "motiveRequired" | "generic" };

const ficheSchema = z.object({
  bio: z.string().check(z.trim(), z.maxLength(500)),
  motive: z.string().check(z.trim(), z.maxLength(VISIT_MOTIVE_MAX)),
  tribes: z.array(z.coerce.number().check(z.int(), z.positive())).check(z.maxLength(5)),
});

/**
 * Updates the presentation (Bad: bio; Visitor: Motif de visite, required) and the distinctive marks
 * (RLS: own rows only; masking and keyword flags in SQL).
 */
export async function updateFicheAction(_state: FicheState, form: FormData): Promise<FicheState> {
  const tribes = form.getAll("tribe");
  if (tribes.length > 5) return { status: "error", message: "tooManySigns" };
  const parsed = ficheSchema.safeParse({
    bio: form.get("bio") ?? "",
    motive: form.get("motive") ?? "",
    tribes,
  });
  if (!parsed.success) return { status: "error", message: "generic" };

  const member = await requireMember();
  const { data: profile } = await member.supabase
    .from("profiles")
    .select("role")
    .eq("id", member.userId)
    .maybeSingle();
  const isVisitor = profile?.role === "visitor";
  if (isVisitor && parsed.data.motive.length === 0) {
    return { status: "error", message: "motiveRequired" };
  }
  const { error: textError } = await member.supabase
    .from("profiles")
    .update(
      isVisitor
        ? { visit_motive: parsed.data.motive }
        : { bio: parsed.data.bio.length > 0 ? parsed.data.bio : null },
    )
    .eq("id", member.userId);
  if (textError) return { status: "error", message: "generic" };

  const { error: deleteError } = await member.supabase
    .from("profile_tribes")
    .delete()
    .eq("profile_id", member.userId);
  if (deleteError) return { status: "error", message: "generic" };
  if (parsed.data.tribes.length > 0) {
    const rows = parsed.data.tribes.map((tribeId) => {
      const detail = String(form.get(`detail-${tribeId}`) ?? "")
        .trim()
        .slice(0, 60);
      return {
        profile_id: member.userId,
        tribe_id: tribeId,
        detail: detail.length > 0 ? detail : null,
      };
    });
    const { error } = await member.supabase.from("profile_tribes").insert(rows);
    if (error)
      return {
        status: "error",
        message: error.message.includes("too_many") ? "tooManySigns" : "generic",
      };
  }
  revalidatePath("/[locale]/ma-fiche", "page");
  return { status: "saved" };
}

/** « Compris »: the Greffe's unread notifications are marked as read (own rows only, in SQL). */
export async function markNoticesReadAction(): Promise<void> {
  const member = await requireMember();
  await member.supabase.rpc("mark_notifications_read", {
    p_types: ["moderation_decision", "permit_granted", "fiche_online"],
  });
  revalidatePath("/[locale]/ma-fiche", "page");
}
