import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GreffeThread } from "@/components/greffe-mail/thread";
import { Link } from "@/i18n/navigation";
import { requireMemberArea } from "@/lib/auth/user";
import { memberThreadSchema } from "@/lib/greffe-mail";
import { withUrls } from "@/lib/greffe-mail-server";
import { memberTimezone } from "@/lib/relations/schedule";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "GreffeMail" });
  return { title: t("title") };
}

/**
 * Courrier du Greffe (10g): the member's thread with the team. The member answers while it is
 * open and never opens one; the team signs « Le Greffe » and a first name or team pseudo.
 */
export default async function GreffeMailPage() {
  const member = await requireMemberArea();
  const t = await getTranslations("GreffeMail");
  const [{ data }, { data: profile }, tz] = await Promise.all([
    member.supabase.rpc("greffe_my_thread"),
    member.supabase.from("profiles").select("role").eq("id", member.userId).maybeSingle(),
    memberTimezone(member.supabase, member.userId),
  ]);
  const parsed = data ? memberThreadSchema.safeParse(data) : null;
  const thread = parsed?.success ? parsed.data : null;
  const messages = thread ? await withUrls(member.supabase, thread.messages) : [];
  const role = profile?.role === "visitor" ? "visitor" : "bad";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <Link href="/ma-fiche" className="text-grey text-sm underline underline-offset-4">
          {t("back")}
        </Link>
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85">{t("lead")}</p>
      </div>
      {thread ? (
        <>
          {thread.archived_at ? (
            <p role="note" className="border-line bg-ink-2 rounded-lg border px-4 py-3 text-sm">
              {t("closed")}
            </p>
          ) : null}
          <GreffeThread
            threadId={thread.id}
            side="member"
            initial={messages}
            memberReadId={thread.member_read_id}
            teamReadId={thread.team_read_id}
            canWrite={thread.archived_at === null}
            otherName={t("greffe")}
            memberRole={role}
            tz={tz}
          />
        </>
      ) : (
        <p className="border-line bg-ink-2 rounded-lg border px-4 py-3">{t("none")}</p>
      )}
      <p className="text-grey text-sm">
        {t("safety")}{" "}
        <Link href="/conseils-securite" className="text-cream underline underline-offset-4">
          {t("safetyLink")}
        </Link>
      </p>
    </div>
  );
}
