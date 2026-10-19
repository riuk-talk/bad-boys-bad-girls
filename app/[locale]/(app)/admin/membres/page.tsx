import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Outcome } from "@/components/admin/outcome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.members" });
  return { title: t("title") };
}

/** Recherche d'un membre (SPEC §15): by the start of the pseudo or the exact e-mail. */
export default async function MembersPage({ searchParams }: Props) {
  const member = await requireMember();
  const { data: isAdmin } = await member.supabase.rpc("is_admin");
  if (isAdmin !== true) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const { q, error } = await searchParams;
  const query = (q ?? "").trim().slice(0, 254);
  const { data } = query
    ? await member.supabase.rpc("admin_find_members", { p_query: query })
    : { data: [] };
  const rows = data ?? [];

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
      {query && rows.length === 0 ? <p className="text-grey">{t("members.none")}</p> : null}
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
              {row.role ? t(`roles.${row.role}`) : null} · {t(`states.${row.state}`)} ·{" "}
              {t("members.since", {
                date: format.dateTime(new Date(row.created_at), { dateStyle: "medium" }),
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
