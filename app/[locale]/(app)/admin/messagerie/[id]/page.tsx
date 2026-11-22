import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import * as z from "zod/mini";
import { Outcome } from "@/components/admin/outcome";
import { ProposePhoto } from "@/components/greffe-mail/propose-photo";
import { GreffeThread } from "@/components/greffe-mail/thread";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { adminCan, requireAdminPermission } from "@/lib/admin/guard";
import { teamThreadSchema } from "@/lib/greffe-mail";
import { withUrls } from "@/lib/greffe-mail-server";
import { DEFAULT_TZ } from "@/lib/relations/schedule";
import { archiveThreadAction } from "../actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.messagerie" });
  return { title: t("threadTitle") };
}

/**
 * A thread of the Messagerie (10g, members.message): the messages (each opening logged), the
 * answer, the archiving, a retouched photo to propose. The member's record is one click away for a
 * role that may open it.
 */
export default async function MessagerieThreadPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const member = await requireAdminPermission("members.message");
  const t = await getTranslations("Admin.messagerie");
  const admin = await getTranslations("Admin");
  const { error, done } = await searchParams;
  const { data, error: readError } = await member.supabase.rpc("admin_messagerie_thread", {
    p_thread: id,
  });
  const parsed = readError ? null : teamThreadSchema.safeParse(data);
  if (!parsed?.success) notFound();
  const thread = parsed.data;
  const [messages, canOpenRecord] = await Promise.all([
    withUrls(member.supabase, thread.messages),
    adminCan(member, "members.detail"),
  ]);
  const archived = thread.archived_at !== null;
  const pseudo = thread.pseudo ?? admin("noPseudo");

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <Link href="/admin/messagerie" className="text-grey text-sm underline underline-offset-4">
          {t("back")}
        </Link>
        <h1 className="font-display text-4xl tracking-wide uppercase">
          {t("threadHeading", { pseudo })}
        </h1>
        <p className="text-cream/85 text-sm">
          {thread.role ? admin(`roles.${thread.role}`) : null} ·{" "}
          {admin(`states.${thread.member_state as "active"}`)}
          {archived ? ` · ${t("archivedTag")}` : null}
        </p>
        {!thread.reachable ? (
          <p role="note" className="text-red-bright text-sm">
            {t("unreachable")}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {canOpenRecord ? (
            <Link
              href={`/admin/membres/${thread.member_id}`}
              className="inline-flex min-h-11 items-center underline underline-offset-4"
            >
              {t("openRecord")}
            </Link>
          ) : null}
          <form action={archiveThreadAction}>
            <input type="hidden" name="thread" value={thread.id} />
            <input type="hidden" name="archived" value={archived ? "0" : "1"} />
            <Button type="submit" variant="secondary">
              {archived ? t("reopen") : t("archive")}
            </Button>
          </form>
        </div>
        <Outcome error={error} done={done} />
      </div>

      <GreffeThread
        threadId={thread.id}
        side="team"
        initial={messages}
        memberReadId={thread.member_read_id}
        teamReadId={thread.team_read_id}
        canWrite
        canModerate={!thread.reachable}
        otherName={pseudo}
        memberRole={thread.role}
        tz={DEFAULT_TZ}
      />

      {thread.reachable ? (
        <section
          aria-labelledby="propose-title"
          className="border-line space-y-3 rounded-lg border p-4"
        >
          <h2 id="propose-title" className="font-display text-2xl uppercase">
            {t("proposeTitle")}
          </h2>
          <ProposePhoto threadId={thread.id} visitor={thread.role === "visitor"} />
        </section>
      ) : null}
    </div>
  );
}
