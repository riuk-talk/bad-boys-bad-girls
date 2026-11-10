import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { parseRole, type Role } from "@/lib/onboarding/config";
import type { Database } from "@/lib/supabase/database.types";
import { ficheSchema, type FicheView, permitSchema, type PermitView } from "./types";

type Client = SupabaseClient<Database>;

/** Public URL of a photo validated by the Greffe (random UUID name in the public bucket). */
export function publicPhotoUrl(supabase: Client, path: string | null | undefined): string | null {
  return path ? supabase.storage.from("photos").getPublicUrl(path).data.publicUrl : null;
}

/**
 * A member who finished the onboarding, with their role. A page meant for the other role
 * sends the member to their own home (the Promenade for a Visitor, the Courrier for a Bad).
 */
export async function requireRole(expected?: Role) {
  const member = await requireMember();
  const locale = await getLocale();
  const { data: profile } = await member.supabase
    .from("profiles")
    .select(
      "role, gender, onboarding_completed_at, consecutive_dismissals, requests_cap, requests_closed_manual, requests_open, pending_requests_count, is_paused, visit_motive, role_changed_at, seeking_genders, seek_age_min, seek_age_max",
    )
    .eq("id", member.userId)
    .maybeSingle();
  if (!profile?.onboarding_completed_at) return redirect({ href: "/onboarding", locale });
  const role = parseRole(profile.role) ?? "visitor";
  if (expected && role !== expected) {
    return redirect({ href: role === "bad" ? "/courrier" : "/promenade", locale });
  }
  return { ...member, locale, role, profile };
}

/** The Fiche of a Bad as the connected member may see it, or null (unknown, hidden, blocked). */
export async function loadFiche(supabase: Client, badId: string): Promise<FicheView | null> {
  const { data, error } = await supabase.rpc("get_fiche", { p_bad: badId });
  if (error || !data) return null;
  const parsed = ficheSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** A Visitor's Permis as the connected member may see it, or null. */
export async function loadPermit(supabase: Client, visitorId: string): Promise<PermitView | null> {
  const { data, error } = await supabase.rpc("get_permit", { p_visitor: visitorId });
  if (error || !data) return null;
  const parsed = permitSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Postgres error codes raised by the member functions, mapped to i18n keys. */
export function requestErrorKey(message: string | undefined): string {
  const known = [
    // La Cavale (Phase 6), before the shorter keys they contain.
    "date_too_soon",
    "date_too_far",
    "date_pending",
    "date_accepted_exists",
    "date_past",
    "not_yet_wait",
    "venue_invalid",
    "venue_required",
    "visitors_only",
    "permit_pending",
    "zone_closed",
    "invalid_guess",
    "note_too_long",
    "not_found",
    "cooldown",
    "already_requested",
    "daily_limit",
    "parloir_full",
    "not_pending",
    "role_change_too_soon",
    "visit_motive_required",
    "report_limit",
    "invalid_target",
    // Les Heures de visite (Phase 5b).
    "slots_count",
    "slot_duplicate",
    "slot_invalid",
    "slot_too_soon",
    "slot_too_far",
    "slot_busy",
    "slot_unavailable",
    "visitor_busy",
    "not_open",
    "already_declined",
    "not_expected",
    "not_cancellable",
    "not_accepted",
    // Le Parloir (Phase 5c).
    "message_empty",
    "message_too_long",
    "rate_limited",
    "conversation_closed",
    "already_chosen",
    "choice_required",
  ];
  return known.find((key) => message?.includes(key)) ?? "generic";
}
