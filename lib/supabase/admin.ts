import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";
import type { Database } from "./database.types";

/**
 * Supabase client with the SECRET key: bypasses RLS. Server-side only (CLAUDE.md), for the few
 * operations the database deliberately refuses to members: recording consents with the real
 * IP, publishing validated photos, account deletion.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error("Missing SUPABASE_SECRET_KEY (server environment only).");
  return createClient<Database>(supabaseConfig().url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
