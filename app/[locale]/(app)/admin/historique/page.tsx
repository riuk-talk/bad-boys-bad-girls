import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.log" });
  return { title: t("title") };
}

/** Historique des décisions (SPEC §15): every moderation decision, the newest first. */
export default async function LogPage() {
  const member = await requireMember();
  const { data: isAdmin } = await member.supabase.rpc("is_admin");
  if (isAdmin !== true) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const { data } = await member.supabase.rpc("admin_moderation_log", { p_limit: 200 });
  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-4xl tracking-wide uppercase">{t("log.title")}</h1>
      {rows.length === 0 ? <p className="text-grey">{t("log.empty")}</p> : null}
      <ul className="divide-line divide-y">
        {rows.map((row) => (
          <li key={row.action_id} className="space-y-1 py-3">
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-semibold">{t(`actions.${row.action}`)}</span>
              {row.target_user_id ? (
                <Link
                  href={`/admin/membres/${row.target_user_id}`}
                  className="underline underline-offset-4"
                >
                  {row.target_pseudo ?? t("noPseudo")}
                </Link>
              ) : null}
              <span className="text-grey text-sm">
                {format.dateTime(new Date(row.created_at), {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </p>
            {row.reason ? <p className="text-sm whitespace-pre-wrap">{row.reason}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
