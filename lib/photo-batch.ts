/**
 * The batch cut-out of the photos validated before the owner's final decision (2026-10-23) runs
 * on the preview only. Two locks: this one (the site must be wired to the preview base, or to a
 * local stack for the tests), and `app_settings.photo_batch_allowed` in the base itself, switched
 * on by hand on the preview only.
 */
export const PREVIEW_PROJECT_REF = "chvnmzmvcjvhxlnfmlvv";

export function photoBatchAllowed(supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false;
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    return false;
  }
  if (url.protocol === "https:" && url.hostname === `${PREVIEW_PROJECT_REF}.supabase.co`)
    return true;
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}
