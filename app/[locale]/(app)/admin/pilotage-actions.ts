"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import * as z from "zod/mini";
import { redirect } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { REPORT_CATEGORIES } from "@/lib/moderation";
import { pilotageErrorKey, type PilotageError } from "@/lib/pilotage";

/**
 * Le pilotage (SPEC §3, §15). Postgres checks everything again (is_admin() with the second
 * factor, every bound); these actions validate the form and come back with the outcome.
 */

async function back(path: string, error?: PilotageError): Promise<never> {
  revalidatePath(`/[locale]${path}`, "page");
  return redirect({
    href: error ? `${path}?error=${error}` : `${path}?done=1`,
    locale: await getLocale(),
  });
}

const smallint = z.coerce.number().check(z.int(), z.minimum(0), z.maximum(32767));
const optionalId = z.optional(z.coerce.number().check(z.int(), z.positive()));
const checkbox = (value: FormDataEntryValue | null) => value === "on";

const zoneSchema = z.object({
  zone: optionalId,
  slug: z.string().check(z.regex(/^[a-z0-9-]{2,40}$/)),
  name: z.string().check(z.trim(), z.minLength(2), z.maxLength(60)),
  place: z.string().check(z.trim(), z.minLength(2), z.maxLength(80)),
  radius: smallint,
  timezone: z.string().check(z.minLength(3), z.maxLength(60)),
  thresholdBads: z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100000)),
  womenPct: smallint,
  menPct: smallint,
});

export async function saveZoneAction(form: FormData): Promise<void> {
  const path = "/admin/quartiers";
  const parsed = zoneSchema.safeParse({
    zone: form.get("zone") || undefined,
    slug: form.get("slug"),
    name: form.get("name"),
    place: form.get("place"),
    radius: form.get("radius"),
    timezone: form.get("timezone"),
    thresholdBads: form.get("thresholdBads"),
    womenPct: form.get("womenPct"),
    menPct: form.get("menPct"),
  });
  if (!parsed.success) return back(path, "invalid_form");
  const data = parsed.data;
  const member = await requireMember();
  // The centre: one commune, by its name or its postal code (several of the same name → ask for
  // the postal code).
  const { data: places } = await member.supabase.rpc("search_places", {
    p_query: data.place,
    p_limit: 5,
  });
  const exact = (places ?? []).filter(
    (place) =>
      place.name.toLowerCase() === data.place.toLowerCase() ||
      place.postal_codes.includes(data.place),
  );
  const centre = exact.length === 1 ? exact[0] : places?.length === 1 ? places[0] : undefined;
  if (!centre) return back(path, "ambiguous_place");
  const { error } = await member.supabase.rpc("admin_save_zone", {
    p_zone: data.zone,
    p_slug: data.slug,
    p_name: data.name,
    p_center_place: centre.id,
    p_radius_km: data.radius,
    p_timezone: data.timezone,
    p_threshold_bads: data.thresholdBads,
    p_women_pct: data.womenPct,
    p_men_pct: data.menPct,
    p_auto_open: checkbox(form.get("autoOpen")),
  });
  return back(path, error ? pilotageErrorKey(error.message) : undefined);
}

export async function setZoneStatusAction(form: FormData): Promise<void> {
  const path = "/admin/quartiers";
  const parsed = z
    .object({
      zone: z.coerce.number().check(z.int(), z.positive()),
      status: z.enum(["open", "waitlist"]),
    })
    .safeParse({ zone: form.get("zone"), status: form.get("status") });
  if (!parsed.success) return back(path, "invalid_form");
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_set_zone_status", {
    p_zone: parsed.data.zone,
    p_status: parsed.data.status,
  });
  return back(path, error ? pilotageErrorKey(error.message) : undefined);
}

export async function setLaunchModeAction(form: FormData): Promise<void> {
  const path = "/admin/quartiers";
  const parsed = z.enum(["zones", "open"]).safeParse(form.get("mode"));
  if (!parsed.success) return back(path, "invalid_form");
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_set_launch_mode", { p_mode: parsed.data });
  return back(path, error ? pilotageErrorKey(error.message) : undefined);
}

const tribeSchema = z.object({
  tribe: optionalId,
  slug: z.string().check(z.regex(/^[a-z0-9-]{2,40}$/)),
  fr: z.string().check(z.trim(), z.minLength(2), z.maxLength(40)),
  en: z.string().check(z.trim(), z.minLength(2), z.maxLength(40)),
  sort: smallint,
});

export async function saveTribeAction(form: FormData): Promise<void> {
  const path = "/admin/signes";
  const parsed = tribeSchema.safeParse({
    tribe: form.get("tribe") || undefined,
    slug: form.get("slug"),
    fr: form.get("fr"),
    en: form.get("en"),
    sort: form.get("sort"),
  });
  if (!parsed.success) return back(path, "invalid_form");
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_save_tribe", {
    p_tribe: parsed.data.tribe,
    p_slug: parsed.data.slug,
    p_label_fr: parsed.data.fr,
    p_label_en: parsed.data.en,
    p_sort: parsed.data.sort,
    p_active: checkbox(form.get("active")),
  });
  return back(path, error ? pilotageErrorKey(error.message) : undefined);
}

const keywordSchema = z.object({
  keyword: optionalId,
  term: z.string().check(z.trim(), z.minLength(2), z.maxLength(60)),
  lang: z.enum(["fr", "en"]),
  category: z.enum(REPORT_CATEGORIES),
});

export async function saveKeywordAction(form: FormData): Promise<void> {
  const path = "/admin/mots-cles";
  const parsed = keywordSchema.safeParse({
    keyword: form.get("keyword") || undefined,
    term: form.get("term"),
    lang: form.get("lang"),
    category: form.get("category"),
  });
  if (!parsed.success) return back(path, "invalid_form");
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_save_keyword", {
    p_keyword: parsed.data.keyword,
    p_term: parsed.data.term,
    p_lang: parsed.data.lang,
    p_category: parsed.data.category,
    p_active: checkbox(form.get("active")),
  });
  return back(path, error ? pilotageErrorKey(error.message) : undefined);
}

const label = z.string().check(z.trim(), z.minLength(1), z.maxLength(200));

export async function saveQuestionAction(form: FormData): Promise<void> {
  const path = "/admin/questions";
  const question = z.coerce.number().check(z.int(), z.positive()).safeParse(form.get("question"));
  const optionIds = form.getAll("optionId");
  const options = optionIds.map((id) => ({
    id: Number(id),
    fr: label.safeParse(form.get(`optionFr-${String(id)}`)),
    en: label.safeParse(form.get(`optionEn-${String(id)}`)),
  }));
  const fr = label.safeParse(form.get("fr"));
  const en = label.safeParse(form.get("en"));
  if (
    !question.success ||
    !fr.success ||
    !en.success ||
    options.some(
      (option) => !Number.isInteger(option.id) || !option.fr.success || !option.en.success,
    )
  ) {
    return back(path, "invalid_form");
  }
  const member = await requireMember();
  const { error } = await member.supabase.rpc("admin_save_question", {
    p_question: question.data,
    p_label_fr: fr.data,
    p_label_en: en.data,
    p_active: checkbox(form.get("active")),
    p_options: options.map((option) => ({
      id: option.id,
      fr: option.fr.data ?? "",
      en: option.en.data ?? "",
    })),
  });
  return back(path, error ? pilotageErrorKey(error.message) : undefined);
}
