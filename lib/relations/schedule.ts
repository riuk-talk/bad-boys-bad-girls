import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod/mini";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** The quartiers all live in Europe/Paris for now; a zone may carry its own (launch_zones). */
export const DEFAULT_TZ = "Europe/Paris";

const slotSchema = z.object({
  id: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  status: z.string(),
  available: z.boolean(),
});
const scheduleSchema = z.object({
  request_id: z.string(),
  status: z.string(),
  round: z.number(),
  slots_declined: z.boolean(),
  choose_deadline: z.nullable(z.string()),
  repropose_deadline: z.nullable(z.string()),
  can_propose: z.boolean(),
  visit: z.nullable(
    z.object({ id: z.string(), starts_at: z.string(), ends_at: z.string(), status: z.string() }),
  ),
  slots: z.array(slotSchema),
});

export type Schedule = z.infer<typeof scheduleSchema>;
export type ScheduleSlot = z.infer<typeof slotSchema>;

/** Les Heures de visite of one request, as get_request_schedule() gives them (participants only). */
export async function loadSchedule(supabase: Client, requestId: string): Promise<Schedule | null> {
  const { data, error } = await supabase.rpc("get_request_schedule", { p_request: requestId });
  if (error || !data) return null;
  const parsed = scheduleSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Time zone of the member's quartier (local time of the shortcuts and of every date shown). */
export async function memberTimezone(supabase: Client, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("zone_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.zone_id) return DEFAULT_TZ;
  const { data: zone } = await supabase
    .from("launch_zones")
    .select("timezone")
    .eq("id", profile.zone_id)
    .maybeSingle();
  return zone?.timezone ?? DEFAULT_TZ;
}
