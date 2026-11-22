import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Outcome } from "@/components/admin/outcome";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { requireAdminPermission } from "@/lib/admin/guard";
import { cn } from "@/lib/cn";
import { newThreadAction, teamNameAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.messagerie" });
  return { title: t("title") };
}

const FILTERS = ["open", "waiting", "archived"] as const;
type Filter = (typeof FILTERS)[number];
const field = "border-line bg-ink-2 min-h-11 w-full rounded-lg border px-3 py-2";

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Messagerie (10g, members.message): the threads of the team with the members, unread first;
 * filters « ouverts », « en attente de réponse », « archivés »; search on the pseudo or the text.
 * A new thread from here (pseudo or N° d'écrou), from a member's record or from the Greffe.
 */
export default async function MessageriePage({ searchParams }: Props) {
  const member = await requireAdminPermission("members.message");
  const t = await getTranslations("Admin.messagerie");
  const admin = await getTranslations("Admin");
  const format = await getFormatter();
  const params = await searchParams;
  const filter: Filter = FILTERS.find((value) => value === one(params.filtre)) ?? "open";
  const q = (one(params.q) ?? "").slice(0, 60);
  const page = Math.max(1, Number.parseInt(one(params.page) ?? "1", 10) || 1);
  const [{ data: rows }, { data: teamName }] = await Promise.all([
    member.supabase.rpc("admin_messagerie_threads", {
      p_filter: filter,
      p_query: q.trim() || undefined,
      p_page: page,
    }),
    member.supabase.rpc("greffe_my_team_name"),
  ]);
  const threads = rows ?? [];
  const total = Number(threads[0]?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / 30));
  const query = (next: { filtre?: Filter; page?: number }) => {
    const search = new URLSearchParams();
    search.set("filtre", next.filtre ?? filter);
    if (q) search.set("q", q);
    if ((next.page ?? 1) > 1) search.set("page", String(next.page));
    return `/admin/messagerie?${search.toString()}`;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("lead")}</p>
        <Outcome error={one(params.error)} done={one(params.done)} />
      </div>

      <section aria-labelledby="new-title" className="border-line space-y-3 rounded-lg border p-4">
        <h2 id="new-title" className="font-display text-2xl uppercase">
          {t("newTitle")}
        </h2>
        <p className="text-cream/85 text-sm">{t("newLead")}</p>
        <form action={newThreadAction} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="space-y-1 text-sm">
            <span className="font-semibold">{t("newMember")}</span>
            <input name="query" required minLength={2} maxLength={254} className={field} />
          </label>
          <Button type="submit">{t("newSubmit")}</Button>
        </form>
      </section>

      <section aria-labelledby="threads-title" className="space-y-4">
        <h2 id="threads-title" className="font-display text-2xl uppercase">
          {t("threadsTitle")}
        </h2>
        <nav aria-label={t("filters")} className="flex flex-wrap gap-2">
          {FILTERS.map((value) => (
            <Link
              key={value}
              href={query({ filtre: value })}
              aria-current={value === filter ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-semibold",
                value === filter ? "bg-cream text-ink border-cream" : "border-line",
              )}
            >
              {t(`filter.${value}`)}
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-end gap-2" role="search">
          <input type="hidden" name="filtre" value={filter} />
          <label className="min-w-56 flex-1 space-y-1 text-sm">
            <span className="font-semibold">{t("search")}</span>
            <input name="q" defaultValue={q} maxLength={60} className={field} />
          </label>
          <Button type="submit" variant="secondary">
            {t("searchSubmit")}
          </Button>
        </form>
        <p role="status" className="text-grey text-sm">
          {t("count", { count: total })}
        </p>
        <ul className="divide-line divide-y">
          {threads.map((row) => (
            <li key={row.thread_id}>
              <Link
                href={`/admin/messagerie/${row.thread_id}`}
                className="hover:bg-ink-2 flex min-h-14 flex-col gap-1 px-2 py-3"
                data-testid="thread-row"
              >
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {row.pseudo ?? admin("noPseudo")}
                  {row.unread > 0 ? (
                    <span className="bg-red-ink text-cream rounded-full px-2 text-xs font-bold">
                      {t("unread", { count: row.unread })}
                    </span>
                  ) : null}
                  <span className="text-grey text-xs font-normal">
                    {row.role ? admin(`roles.${row.role}`) : null} ·{" "}
                    {admin(`states.${row.member_state as "active"}`)}
                  </span>
                </span>
                <span className="text-cream/85 line-clamp-2 text-sm">
                  {row.last_side === "member" ? `${t("theyWrote")} ` : ""}
                  {row.last_preview || t("noText")}
                </span>
                {row.last_message_at ? (
                  <span className="text-grey text-xs">
                    {format.dateTime(new Date(row.last_message_at), {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
        {threads.length === 0 ? <p className="text-grey">{t("none")}</p> : null}
        {pages > 1 ? (
          <nav aria-label={t("pages")} className="flex items-center justify-between gap-3">
            {page > 1 ? (
              <Link
                href={query({ page: page - 1 })}
                className="inline-flex min-h-11 items-center underline"
              >
                {t("previous")}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-grey text-sm">{t("page", { page, pages })}</span>
            {page < pages ? (
              <Link
                href={query({ page: page + 1 })}
                className="inline-flex min-h-11 items-center underline"
              >
                {t("next")}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>

      <section aria-labelledby="name-title" className="border-line space-y-3 rounded-lg border p-4">
        <h2 id="name-title" className="font-display text-2xl uppercase">
          {t("nameTitle")}
        </h2>
        <p className="text-cream/85 text-sm">{t("nameLead")}</p>
        <form action={teamNameAction} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="space-y-1 text-sm">
            <span className="font-semibold">{t("nameLabel")}</span>
            <input name="name" maxLength={30} defaultValue={teamName ?? ""} className={field} />
          </label>
          <Button type="submit" variant="secondary">
            {t("nameSubmit")}
          </Button>
        </form>
      </section>
    </div>
  );
}
