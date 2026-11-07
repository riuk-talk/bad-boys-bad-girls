"use server";

import { getTranslations } from "next-intl/server";
import { parseCounts, searchQuery, type AdminCounts } from "@/lib/admin/nav";
import { createClient } from "@/lib/supabase/server";

/**
 * The live counters of the admin menu (10c). The database checks the admin and the second factor
 * (admin_counts, is_admin()); anything refused or malformed gives no counter.
 */
export async function adminCountsAction(): Promise<AdminCounts | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_counts");
  if (error) return null;
  return parseCounts(Array.isArray(data) ? data[0] : data);
}

export type MemberHit = { id: string; pseudo: string; meta: string };

/**
 * « Rechercher un membre » (10c): by pseudo or N° d'écrou (part of it), or by the exact e-mail
 * (admin_search_members, is_admin()). The labels are made here: the browser gets text only.
 */
export async function adminSearchAction(value: string): Promise<MemberHit[] | null> {
  const q = searchQuery(value);
  if (!q) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_search_members", { p_query: q });
  if (error) return null;
  const t = await getTranslations("Admin");
  return (data ?? []).map((row) => ({
    id: row.user_id,
    pseudo: row.pseudo ?? t("noPseudo"),
    meta: [row.role ? t(`roles.${row.role}`) : null, t(`states.${row.state as "active"}`)]
      .filter(Boolean)
      .join(" · "),
  }));
}
