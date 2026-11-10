import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Export of my data (SPEC §10), as a JSON file: my own data only, the other person reduced to
 * their pseudo (export_my_data, under my session). Never cached.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [{ data, error }, { data: identity, error: identityError }] = await Promise.all([
    supabase.rpc("export_my_data"),
    // 10e: my previous pseudos and my requests to correct the date of birth.
    supabase.rpc("my_identity_history"),
  ]);
  if (error || !data || identityError) {
    return NextResponse.json({ error: "export_failed" }, { status: 500 });
  }
  const merged = { ...(data as Record<string, unknown>), ...(identity as Record<string, unknown>) };
  return new NextResponse(JSON.stringify(merged, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="mes-donnees-bad-boys-bad-girls.json"',
      "cache-control": "no-store",
    },
  });
}
