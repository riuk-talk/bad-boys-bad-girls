import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Outcome } from "@/components/admin/outcome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import {
  MEMBER_STATES,
  memberFiltersQuery,
  PAGE_SIZE,
  parseMemberFilters,
} from "@/lib/admin/members";
import { requireAdminPermission } from "@/lib/admin/guard";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.members" });
  return { title: t("title") };
}

const field = "border-line bg-ink-2 min-h-11 w-full rounded-lg border px-3 py-2";

/**
 * Membres (SPEC §15, 10d): every account in pages of 50, newest first, with filters (role, state,
 * dossier finished or not, blocked dossiers); the search by the start of the pseudo or the exact
 * e-mail stays above. Below, the accounts never confirmed after 48 hours (date and domain only).
 */
export default async function MembersPage({ searchParams }: Props) {
  const member = await requireAdminPermission("members.view");
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const error = typeof params.error === "string" ? params.error : undefined;
  const query = q.trim().slice(0, 254);
  const filters = parseMemberFilters(params);

  const [{ data: found }, { data: listed }, { data: unconfirmed }] = await Promise.all([
    query
      ? member.supabase.rpc("admin_find_members", { p_query: query })
      : Promise.resolve({ data: null }),
    query
      ? Promise.resolve({ data: null })
      : member.supabase.rpc("admin_list_members", {
          p_role: filters.role ?? undefined,
          p_state: filters.state ?? undefined,
          p_complete: filters.complete ?? undefined,
          p_blocked: filters.blocked,
          p_page: filters.page,
        }),
    member.supabase.rpc("admin_unconfirmed_accounts"),
  ]);
  const rows = query ? (found ?? []) : (listed ?? []);
  const total = listed?.[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const day = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium" });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("members.title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("members.lead")}</p>
        <Outcome error={error} />
      </div>
      <form role="search" className="flex flex-wrap items-end gap-3">
        <Input
          id="member-search"
          name="q"
          label={t("members.search")}
          defaultValue={query}
          minLength={2}
          maxLength={254}
          className="min-w-64"
        />
        <Button type="submit">{t("members.submit")}</Button>
      </form>

      {query ? (
        <p className="text-sm">
          <Link href="/admin/membres" className="underline underline-offset-4">
            {t("members.allMembers")}
          </Link>
        </p>
      ) : (
        <form
          aria-label={t("members.filters")}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          <div className="space-y-1">
            <label htmlFor="filter-role" className="text-sm font-semibold">
              {t("members.role")}
            </label>
            <select
              id="filter-role"
              name="role"
              defaultValue={filters.role ?? ""}
              className={field}
            >
              <option value="">{t("members.any")}</option>
              <option value="bad">{t("roles.bad")}</option>
              <option value="visitor">{t("roles.visitor")}</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="filter-state" className="text-sm font-semibold">
              {t("members.state")}
            </label>
            <select
              id="filter-state"
              name="etat"
              defaultValue={filters.state ?? ""}
              className={field}
            >
              <option value="">{t("members.any")}</option>
              {MEMBER_STATES.map((state) => (
                <option key={state} value={state}>
                  {t(`states.${state}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="filter-dossier" className="text-sm font-semibold">
              {t("members.dossier")}
            </label>
            <select
              id="filter-dossier"
              name="dossier"
              defaultValue={
                filters.complete === null ? "" : filters.complete ? "termine" : "inacheve"
              }
              className={field}
            >
              <option value="">{t("members.any")}</option>
              <option value="termine">{t("members.complete")}</option>
              <option value="inacheve">{t("members.incomplete")}</option>
            </select>
          </div>
          <label className="flex min-h-11 items-center gap-2 self-end text-sm font-semibold">
            <input
              type="checkbox"
              name="bloques"
              value="1"
              defaultChecked={filters.blocked}
              className="accent-accent size-5"
            />
            {t("members.blockedOnly")}
          </label>
          <Button type="submit" className="self-end">
            {t("members.apply")}
          </Button>
        </form>
      )}

      {!query ? (
        <p className="text-grey text-sm" role="status">
          {t("members.count", { count: total })}
        </p>
      ) : null}
      {rows.length === 0 ? <p className="text-grey">{t("members.none")}</p> : null}
      <ul className="divide-line divide-y">
        {rows.map((row) => (
          <li key={row.user_id} className="flex flex-wrap items-baseline gap-x-3 py-3">
            <Link
              href={`/admin/membres/${row.user_id}`}
              className="font-semibold underline underline-offset-4"
            >
              {row.pseudo ?? t("noPseudo")}
            </Link>
            <span className="text-grey text-sm">
              {row.role ? `${t(`roles.${row.role}`)} · ` : null}
              {t(`states.${row.state as "active"}`)} ·{" "}
              {t("members.since", { date: day(row.created_at) })}
              {"blocked" in row && row.blocked ? ` · ${t("members.blocked")}` : null}
            </span>
          </li>
        ))}
      </ul>

      {!query && pages > 1 ? (
        <nav aria-label={t("members.pages")} className="flex items-center justify-between gap-3">
          {filters.page > 1 ? (
            <Link
              href={`/admin/membres${memberFiltersQuery(filters, filters.page - 1)}`}
              className="inline-flex min-h-11 items-center underline underline-offset-4"
            >
              {t("members.previous")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-grey text-sm">
            {t("members.page", { page: filters.page, pages })}
          </span>
          {filters.page < pages ? (
            <Link
              href={`/admin/membres${memberFiltersQuery(filters, filters.page + 1)}`}
              className="inline-flex min-h-11 items-center underline underline-offset-4"
            >
              {t("members.next")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <section aria-labelledby="unconfirmed-title" className="space-y-3 pt-4">
        <h2 id="unconfirmed-title" className="font-display text-2xl tracking-wide uppercase">
          {t("members.unconfirmedTitle")}
        </h2>
        <p className="text-cream/85 text-sm">{t("members.unconfirmedLead")}</p>
        {(unconfirmed ?? []).length === 0 ? (
          <p className="text-grey">{t("members.unconfirmedNone")}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-grey">
                <th scope="col" className="py-2 font-semibold">
                  {t("members.createdOn")}
                </th>
                <th scope="col" className="py-2 font-semibold">
                  {t("members.domain")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {(unconfirmed ?? []).map((account, index) => (
                <tr key={`${account.created_at}-${index}`}>
                  <td className="py-2">{day(account.created_at)}</td>
                  <td className="py-2 font-mono">{account.domain}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
