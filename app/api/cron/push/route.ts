import { NextResponse, type NextRequest } from "next/server";
import webpush, { WebPushError } from "web-push";
import {
  classifyPushError,
  emptyReport,
  isAuthorizedCron,
  messageOutcome,
  pushPayload,
  type PushLocale,
  type SubscriptionOutcome,
} from "@/lib/push/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Stop claiming new messages after this long: what is left goes on the next minute.
const TIME_BUDGET_MS = 25_000;
const BATCH = 100;

type ClaimedSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: PushLocale;
};

/**
 * Sends the queued Web Push notifications. Called every minute by the database (pg_cron →
 * push_dispatch → pg_net) only when something is due, with the shared secret. The messages are
 * claimed with a 5-minute lease, so two calls never send the same one.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.PUSH_CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    return NextResponse.json({ error: "push_not_configured" }, { status: 503 });
  }

  const supabase = createAdminClient();
  const vapidDetails = { subject, publicKey, privateKey };
  const started = Date.now();
  let sent = 0;

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: jobs, error } = await supabase.rpc("push_claim", { p_limit: BATCH });
    if (error) return NextResponse.json({ error: "claim_failed" }, { status: 500 });
    if (!jobs || jobs.length === 0) break;

    const report = emptyReport();
    await Promise.all(
      jobs.map(async (job) => {
        const subscriptions = (job.subscriptions ?? []) as ClaimedSubscription[];
        const path = (job.payload as { path?: unknown } | null)?.path;
        const outcomes = await Promise.all(
          subscriptions.map(async (sub): Promise<SubscriptionOutcome> => {
            try {
              await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                pushPayload(job.type, path, sub.locale),
                { vapidDetails, TTL: 24 * 3600, urgency: "normal", topic: job.type.slice(0, 32) },
              );
              report.delivered.push(sub.id);
              return "delivered";
            } catch (e) {
              const outcome = classifyPushError(
                e instanceof WebPushError ? e.statusCode : undefined,
              );
              report[outcome].push(sub.id);
              return outcome;
            }
          }),
        );
        report[messageOutcome(outcomes)].push(job.id);
      }),
    );
    sent += report.sent.length;

    const { error: reportError } = await supabase.rpc("push_report", { p_report: report });
    if (reportError) return NextResponse.json({ error: "report_failed" }, { status: 500 });
    if (jobs.length < BATCH) break;
  }

  return NextResponse.json({ sent });
}
