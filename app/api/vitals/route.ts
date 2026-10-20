import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlausible, vitalBatchSchema } from "@/lib/vitals-schema";

export const dynamic = "force-dynamic";

const MAX_BODY = 1024;

/**
 * Real Core Web Vitals (SPEC §18): the measures of one page view (navigator.sendBeacon), added
 * to the daily histogram. Nothing of the request is kept: no IP, no user agent, no session.
 * The secret key records (anon executes no function); only the site's own pages may send.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await request.text();
  if (body.length > MAX_BODY) return NextResponse.json({ error: "invalid" }, { status: 400 });
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = vitalBatchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const admin = createAdminClient();
  for (const vital of parsed.data.filter(isPlausible)) {
    await admin.rpc("record_web_vital", {
      p_page: vital.page,
      p_metric: vital.metric,
      p_value: vital.value,
    });
  }
  return new NextResponse(null, { status: 204 });
}
