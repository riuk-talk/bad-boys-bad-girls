import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Outcome } from "@/components/admin/outcome";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { requireMember } from "@/lib/auth/user";
import { ageOn } from "@/lib/validation/onboarding";
import { decideCorrectionAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.corrections" });
  return { title: t("title") };
}

const field = "border-line bg-ink-2 w-full rounded-lg border px-3 py-2";

/**
 * Corrections of the date of birth (10e): the requests waiting first, then the last decisions.
 * Accept (never under 18, checked again in SQL) or refuse with a motive; the member is notified.
 */
export default async function CorrectionsPage({ searchParams }: Props) {
  const member = await requireMember();
  const { data: isAdmin } = await member.supabase.rpc("is_admin");
  if (isAdmin !== true) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const { error, done } = await searchParams;
  const { data } = await member.supabase.rpc("admin_birthdate_corrections");
  const rows = data ?? [];
  const day = (value: string) =>
    format.dateTime(new Date(`${value.slice(0, 10)}T12:00:00Z`), { dateStyle: "long" });
  const when = (value: string) =>
    format.dateTime(new Date(value), { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("corrections.title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("corrections.lead")}</p>
        <Outcome error={error} done={done} />
      </div>
      {rows.length === 0 ? <p className="text-grey">{t("corrections.none")}</p> : null}
      <ul className="space-y-4">
        {rows.map((row) => (
          <li key={row.id} className="border-line space-y-3 rounded-lg border p-4">
            <p>
              <Link
                href={`/admin/membres/${row.user_id}`}
                className="font-semibold underline underline-offset-4"
              >
                {row.pseudo ?? t("noPseudo")}
              </Link>{" "}
              <span className="text-grey text-sm">{when(row.created_at)}</span>
            </p>
            <p className="text-sm">
              {t("corrections.change", {
                from: day(row.current_birthdate),
                fromAge: ageOn(row.current_birthdate),
                to: day(row.requested_birthdate),
                toAge: ageOn(row.requested_birthdate),
              })}
            </p>
            <p className="text-sm whitespace-pre-wrap">
              {t("corrections.motive", { reason: row.reason })}
            </p>
            {row.status === "pending" ? (
              <form action={decideCorrectionAction} className="space-y-3">
                <input type="hidden" name="correction" value={row.id} />
                <div className="space-y-1">
                  <label htmlFor={`reason-${row.id}`} className="text-sm font-semibold">
                    {t("corrections.reason")}
                  </label>
                  <textarea
                    id={`reason-${row.id}`}
                    name="reason"
                    maxLength={300}
                    aria-describedby={`reason-hint-${row.id}`}
                    className={`${field} min-h-20`}
                  />
                  <p id={`reason-hint-${row.id}`} className="text-grey text-xs">
                    {t("corrections.reasonHint")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" name="decision" value="accept">
                    {t("corrections.accept")}
                  </Button>
                  <Button type="submit" name="decision" value="refuse" variant="danger">
                    {t("corrections.refuse")}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-sm">
                <span className="font-semibold">
                  {t(`corrections.status.${row.status as "accepted"}`)}
                </span>
                {row.decided_at ? ` · ${when(row.decided_at)}` : null}
                {row.decision_reason ? ` · ${row.decision_reason}` : null}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
