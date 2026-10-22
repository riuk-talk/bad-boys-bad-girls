import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cliche } from "./casier";
import type { Database } from "./supabase/database.types";

/** The active clichés déconseillés (SPEC §6 [P1]); an empty list if the read fails (advice only). */
export async function loadCliches(supabase: SupabaseClient<Database>): Promise<Cliche[]> {
  const { data } = await supabase.rpc("get_casier_cliches");
  return data ?? [];
}
