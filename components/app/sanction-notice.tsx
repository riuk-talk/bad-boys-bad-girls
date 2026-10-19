import { getFormatter, getTranslations } from "next-intl/server";
import type { Sanction } from "@/lib/moderation";

/**
 * Shown instead of the site while a sanction is in force (SPEC §10 DSA): what it is, until when,
 * and the motive written by the Greffe. A Fiche under review (« mineur ») says so, nothing more.
 */
export async function SanctionNotice({ sanction }: { sanction: NonNullable<Sanction> }) {
  const t = await getTranslations("Decisions.notice");
  const format = await getFormatter();
  return (
    <section
      aria-labelledby="sanction-title"
      className="mx-auto max-w-2xl space-y-4 px-4 py-12 text-center sm:px-6"
    >
      <h1 id="sanction-title" className="font-display text-4xl tracking-wide uppercase">
        {t(`${sanction.state}.title`)}
      </h1>
      <p className="text-cream/90">
        {t(`${sanction.state}.body`, {
          date: sanction.until
            ? format.dateTime(new Date(sanction.until), { dateStyle: "long", timeStyle: "short" })
            : "",
        })}
      </p>
      {sanction.reason ? (
        <p className="border-line bg-ink-2 rounded-lg border p-4 text-left whitespace-pre-wrap">
          <span className="text-grey block text-sm">{t("motive")}</span>
          {sanction.reason}
        </p>
      ) : null}
      <p className="text-grey text-sm">{t("contact")}</p>
    </section>
  );
}
