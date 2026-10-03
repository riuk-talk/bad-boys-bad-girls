"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod/mini";
import { requireMember } from "@/lib/auth/user";

export type FicheState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: "tooManySigns" | "generic" };

const ficheSchema = z.object({
  bio: z.string().check(z.trim(), z.maxLength(500)),
  tribes: z.array(z.coerce.number().check(z.int(), z.positive())).check(z.maxLength(5)),
});

/** Updates the bio and the distinctive marks (RLS: own rows only; masking and keyword flags in SQL). */
export async function updateFicheAction(_state: FicheState, form: FormData): Promise<FicheState> {
  const tribes = form.getAll("tribe");
  if (tribes.length > 5) return { status: "error", message: "tooManySigns" };
  const parsed = ficheSchema.safeParse({ bio: form.get("bio") ?? "", tribes });
  if (!parsed.success) return { status: "error", message: "generic" };

  const member = await requireMember();
  const { error: bioError } = await member.supabase
    .from("profiles")
    .update({ bio: parsed.data.bio.length > 0 ? parsed.data.bio : null })
    .eq("id", member.userId);
  if (bioError) return { status: "error", message: "generic" };

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
