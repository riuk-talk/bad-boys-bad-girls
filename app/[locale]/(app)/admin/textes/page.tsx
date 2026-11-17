import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Outcome } from "@/components/admin/outcome";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { adminCan, requireAdminPermission } from "@/lib/admin/guard";
import { MOTIVE_MAX } from "@/lib/moderation";
import { decideFlagAction } from "../moderation-actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.flags" });
  return { title: t("title") };
}

/**
 * Textes signalés par mots-clés (SPEC §15): « Rien à signaler », « Retenu » (sanction depuis la
 * fiche du membre) or « Retirer le texte » (bio, précision d'un signe, mot d'une demande,
 * message), with a motive sent to the member.
 */
export default async function FlagsPage({ searchParams }: Props) {
  const member = await requireAdminPermission("flags.decide");
  // Erasing a member's text is its own permission (10f).
  const canErase = await adminCan(member, "texts.edit");
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const { error, done } = await searchParams;
  const { data } = await member.supabase.rpc("admin_flag_queue", { p_limit: 50 });
  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("flags.title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("flags.lead")}</p>
        <p className="text-accent font-semibold" role="status">
          {t("flags.waiting", { count: rows.length })}
        </p>
        <Outcome error={error} done={done} />
      </div>
      {rows.length === 0 ? <p className="text-grey">{t("flags.empty")}</p> : null}
      <ul className="space-y-5">
        {rows.map((row) => (
          <li
            key={row.flag_id}
            className="border-line space-y-3 rounded-lg border bg-[#121214] p-4"
          >
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-accent font-bold">{t(`sources.${row.source}`)}</span>
              <span className="text-grey text-sm">
                {format.dateTime(new Date(row.created_at), {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </p>
            <p>
              {row.user_id ? (
                <Link
                  href={`/admin/membres/${row.user_id}`}
                  className="font-semibold underline underline-offset-4"
                >
                  {row.pseudo ?? t("noPseudo")}
                </Link>
              ) : (
                t("noPseudo")
              )}{" "}
              · {row.role ? t(`roles.${row.role}`) : null} · {t(`states.${row.state}`)}
            </p>
            <div className="bg-ink-2 rounded-md p-3 text-sm whitespace-pre-wrap">{row.excerpt}</div>
            <p className="text-grey text-sm">
              {t("flags.terms", { terms: row.matched_terms.join(", ") })}
            </p>
            <form action={decideFlagAction} className="space-y-3">
              <input type="hidden" name="flag" value={row.flag_id} />
              <div className="space-y-1">
                <label htmlFor={`flag-${row.flag_id}-reason`} className="text-sm font-semibold">
                  {t("flags.reason")}
                </label>
                <textarea
                  id={`flag-${row.flag_id}-reason`}
                  name="reason"
                  maxLength={MOTIVE_MAX}
                  aria-describedby={`flag-${row.flag_id}-hint`}
                  className="border-line bg-ink-2 min-h-20 w-full rounded-lg border px-3 py-2"
                />
                <p id={`flag-${row.flag_id}-hint`} className="text-grey text-xs">
                  {row.removable ? t("flags.hintRemovable") : t("flags.hintNotRemovable")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" name="decision" value="clear" variant="secondary">
                  {t("flags.clear")}
                </Button>
                <Button type="submit" name="decision" value="uphold" variant="secondary">
                  {t("flags.uphold")}
                </Button>
                {row.removable && canErase ? (
                  <Button type="submit" name="decision" value="remove" variant="danger">
                    {t("flags.remove")}
                  </Button>
                ) : null}
              </div>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
