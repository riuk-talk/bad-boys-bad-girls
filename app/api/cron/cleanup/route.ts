import { NextResponse, type NextRequest } from "next/server";
import { removeMemberFiles, rotatePublicPhoto } from "@/lib/cleanup/files";
import { isAuthorizedCron } from "@/lib/push/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIME_BUDGET_MS = 45_000;
const BATCH = 50;

/**
 * Daily clean-up of files and Auth accounts (SCHEMA §3.5), called by the database (pg_cron →
 * cleanup_dispatch → pg_net) only when there is something to do, with the cron secret:
 * - public photos renamed after 30 days of pause and at a ban (SPEC §11);
 * - accounts whose onboarding is not finished 30 days after sign-up (SPEC §4): their files, then
 *   the Auth account (the database rows follow by cascade). Admins and the super admin are never
 *   listed, and the super admin's account is protected in the database anyway.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.PUSH_CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const started = Date.now();
  let rotated = 0;
  let deleted = 0;
  let failed = 0;

  const { data: photos, error: photosError } = await admin.rpc("cleanup_photos_due", {
    p_limit: BATCH,
  });
  if (photosError) return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  for (const photo of photos ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    if (await rotatePublicPhoto(admin, photo)) rotated += 1;
    else failed += 1;
  }

  const { data: accounts, error: accountsError } = await admin.rpc("cleanup_accounts_due", {
    p_limit: BATCH,
  });
  if (accountsError) return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  for (const account of accounts ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const filesRemoved = await removeMemberFiles(
      admin,
      account.user_id,
      account.pending_paths,
      account.public_paths,
    );
    if (!filesRemoved) {
      failed += 1;
      continue;
    }
    const { error } = await admin.auth.admin.deleteUser(account.user_id);
    if (error) failed += 1;
    else deleted += 1;
  }

  return NextResponse.json({ rotated, deleted, failed });
}
