import { NextResponse, type NextRequest } from "next/server";
import * as z from "zod/mini";
import { UNSUBSCRIBABLE } from "@/lib/email/compose";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const schema = z.object({ t: z.uuid(), k: z.enum(UNSUBSCRIBABLE) });

/**
 * One-click unsubscribe (RFC 8058, header List-Unsubscribe-Post): the mail client POSTs here.
 * A GET (a link opened, or prefetched by a scanner) changes nothing: it shows the page that asks.
 */
export async function POST(request: NextRequest) {
  const parsed = schema.safeParse({
    t: request.nextUrl.searchParams.get("t"),
    k: request.nextUrl.searchParams.get("k"),
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  // The token is the only proof: the secret key runs the update (anon executes no function).
  const admin = createAdminClient();
  const { error } = await admin.rpc("unsubscribe_email", {
    p_token: parsed.data.t,
    p_kind: parsed.data.k,
  });
  return error
    ? NextResponse.json({ error: "failed" }, { status: 500 })
    : NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const target = new URL("/fr/desinscription", request.nextUrl.origin);
  for (const key of ["t", "k"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target, 303);
}
