import { NextResponse, type NextRequest } from "next/server";
import { brevoConfig, sendWithBrevo } from "@/lib/email/brevo";
import { composeEmail, EMAIL_KINDS, isUnsubscribable, type EmailKind } from "@/lib/email/compose";
import { SITE_URL } from "@/lib/env";
import { isAuthorizedCron } from "@/lib/push/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIME_BUDGET_MS = 40_000;
const BATCH = 20;

const isKind = (kind: string): kind is EmailKind => EMAIL_KINDS.some((value) => value === kind);

/**
 * Sends the queued e-mails (SPEC §16). Called every 10 minutes by the database (pg_cron →
 * email_dispatch → pg_net) only when something is due and the day's quota allows it, with the
 * cron secret. The database claims within the quota and drops what is no longer wanted.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.PUSH_CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const config = brevoConfig();
  if (!config) return NextResponse.json({ error: "email_not_configured" }, { status: 503 });

  const admin = createAdminClient();
  const started = Date.now();
  let sent = 0;
  let failed = 0;

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: jobs, error } = await admin.rpc("email_claim", { p_limit: BATCH });
    if (error) return NextResponse.json({ error: "claim_failed" }, { status: 500 });
    if (!jobs || jobs.length === 0) break;
    for (const job of jobs) {
      const locale = job.locale === "en" ? "en" : "fr";
      let ok = false;
      if (job.recipient && isKind(job.kind)) {
        const payload = (job.payload ?? {}) as Record<string, unknown>;
        let detail: string | undefined;
        if (job.kind === "moderation_decision" && typeof payload.action_id === "number") {
          const { data } = await admin
            .from("moderation_actions")
            .select("reason")
            .eq("id", payload.action_id)
            .maybeSingle();
          detail = data?.reason ?? undefined;
        } else if (job.kind === "admin_zone_ready" && typeof payload.zone_id === "number") {
          const { data } = await admin
            .from("launch_zones")
            .select("name")
            .eq("id", payload.zone_id)
            .maybeSingle();
          detail = data?.name ?? undefined;
        }
        const unsubscribe =
          isUnsubscribable(job.kind) && job.unsubscribe_token
            ? {
                url: `${SITE_URL}/${locale}/desinscription?t=${job.unsubscribe_token}&k=${job.kind}`,
                oneClick: `${SITE_URL}/api/email/unsubscribe?t=${job.unsubscribe_token}&k=${job.kind}`,
              }
            : undefined;
        const email = composeEmail(job.kind, locale, SITE_URL, {
          detail,
          unsubscribeUrl: unsubscribe?.url,
        });
        ok = await sendWithBrevo(config, job.recipient, email, unsubscribe);
      }
      await admin.rpc("email_report", { p_email: job.email_id, p_sent: ok });
      if (ok) sent += 1;
      else failed += 1;
    }
  }
  return NextResponse.json({ sent, failed });
}
