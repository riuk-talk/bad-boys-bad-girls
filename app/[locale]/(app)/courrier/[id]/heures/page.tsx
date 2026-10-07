import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Stamp } from "@/components/brand/stamp";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { HoursPicker } from "@/components/relations/hours-picker";
import { redirect } from "@/i18n/navigation";
import { customOptions, shortcuts } from "@/lib/hours";
import { loadSchedule, memberTimezone } from "@/lib/relations/schedule";
import { requireRole } from "@/lib/relations/server";

type Props = { params: Promise<{ locale: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Relations.hours" });
  return { title: t("metaTitle") };
}

/**
 * Les Heures de visite (SPEC §7 bis, maquette Heures.dc.html). Accepting a request means sending
 * these slots (accept_visit_request); after « Aucun ne me va » or a cancelled visit, the same
 * screen proposes new ones (propose_slots).
 */
export default async function HoursPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, userId, locale } = await requireRole("bad");
  const { data: mailbox } = await supabase.rpc("get_mailbox");
  const row = (mailbox ?? []).find((entry) => entry.request_id === id);
  if (!row) notFound();
  let mode: "accept" | "repropose" = "accept";
  if (row.status === "accepted") {
    const schedule = await loadSchedule(supabase, id);
    if (!schedule?.can_propose) return redirect({ href: `/courrier/${id}`, locale });
    mode = schedule.round === 0 ? "accept" : "repropose";
  }
  const t = await getTranslations("Relations.hours");
  const tz = await memberTimezone(supabase, userId);
  const now = new Date();

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-2 sm:px-6 sm:py-4">
      <LocalizedLink
        href={`/courrier/${id}`}
        className="text-cream hover:text-accent inline-flex min-h-11 items-center gap-1 self-start text-sm font-semibold"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        {t("back", { pseudo: row.pseudo })}
      </LocalizedLink>
      <header className="flex flex-col items-center gap-2.5 text-center">
        {mode === "accept" ? (
          <Stamp kind="visitAccepted" surface="dark" size="md" tilt={-5} />
        ) : null}
        <h1 className="font-display mt-2 text-[30px] leading-tight uppercase">
          {mode === "accept" ? t("title") : t("titleAgain")}
        </h1>
        <p className="text-cream/90 text-[15px]">{t("lead", { pseudo: row.pseudo })}</p>
      </header>
      <HoursPicker
        requestId={id}
        mode={mode}
        pseudo={row.pseudo}
        tz={tz}
        shortcuts={shortcuts(now, tz).map((s) => ({
          key: s.key,
          start: s.start ? s.start.toISOString() : null,
        }))}
        days={customOptions(now, tz)}
      />
    </div>
  );
}
