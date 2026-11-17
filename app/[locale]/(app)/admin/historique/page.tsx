import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAdminPermission } from "@/lib/admin/guard";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.log" });
  return { title: t("title") };
}

/** Historique des décisions (SPEC §15): every moderation decision, the newest first. */
export default async function LogPage() {
  const member = await requireAdminPermission("history.view");
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const [{ data }, { data: teamData }] = await Promise.all([
    member.supabase.rpc("admin_moderation_log", { p_limit: 200 }),
    // The team's changes (10f): who did what, when, before and after.
    member.supabase.rpc("admin_team_history", { p_limit: 100 }),
  ]);
  const rows = data ?? [];
  const team = teamData ?? [];
  const when = (value: string) =>
    format.dateTime(new Date(value), { dateStyle: "short", timeStyle: "short" });
  const describe = (state: unknown): string => {
    if (!state || typeof state !== "object") return "—";
    const value = state as { role?: string; name?: string; permissions?: string[] };
    if (value.role) return value.role;
    const permissions = (value.permissions ?? [])
      .map((p) => t(`permissions.${p.replace(".", "_")}` as "permissions.dashboard_view"))
      .join(", ");
    return `${value.name ?? "—"} (${permissions || t("team.noPermission")})`;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-4xl tracking-wide uppercase">{t("log.title")}</h1>
      <section aria-labelledby="team-log-title" className="space-y-2">
        <h2 id="team-log-title" className="font-display text-2xl uppercase">
          {t("team.logTitle")}
        </h2>
        {team.length === 0 ? <p className="text-grey">{t("log.empty")}</p> : null}
        <ul className="divide-line divide-y">
          {team.map((row) => (
            <li key={row.id} className="space-y-1 py-3 text-sm">
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-semibold">{t(`team.log.${row.action as "grant"}`)}</span>
                {row.target ? <span>{row.target}</span> : null}
                <span className="text-grey">
                  {t("team.by", { who: row.actor ?? "—" })} · {when(row.created_at)}
                </span>
              </p>
              <p className="text-cream/85">
                {t("team.beforeAfter", {
                  before: describe(row.before),
                  after: describe(row.after),
                })}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <h2 className="font-display text-2xl uppercase">{t("log.moderationTitle")}</h2>
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
