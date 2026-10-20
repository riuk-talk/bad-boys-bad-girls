"use server";

import { getLocale } from "next-intl/server";
import * as z from "zod/mini";
import { redirect } from "@/i18n/navigation";
import { UNSUBSCRIBABLE } from "@/lib/email/compose";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ t: z.uuid(), k: z.enum(UNSUBSCRIBABLE) });

/** Désinscription par type (SPEC §16), from the link of an e-mail: no session needed. */
export async function unsubscribeAction(form: FormData): Promise<void> {
  const locale = await getLocale();
  const parsed = schema.safeParse({ t: form.get("t"), k: form.get("k") });
  if (!parsed.success) return redirect({ href: "/desinscription?done=error", locale });
  // The token is the only proof: the secret key runs the update (anon executes no function).
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("unsubscribe_email", {
    p_token: parsed.data.t,
    p_kind: parsed.data.k,
  });
  return redirect({
    href: `/desinscription?done=${error || data !== true ? "error" : "ok"}`,
    locale,
  });
}
