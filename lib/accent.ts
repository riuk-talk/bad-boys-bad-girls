import type { Database } from "@/lib/supabase/database.types";

type Gender = Database["public"]["Enums"]["gender"];
export type Accent = "gold" | "red" | "cream";

/** Colours designate the gender, never the role (PARCOURS-DESIGN §1). Gold until it is known. */
export function accentForGender(gender: Gender | null | undefined): Accent {
  if (gender === "woman") return "red";
  if (gender === "non_binary" || gender === "other") return "cream";
  return "gold";
}
