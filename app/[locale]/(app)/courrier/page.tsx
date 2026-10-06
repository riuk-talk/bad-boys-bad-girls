import { Mail, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Stamp } from "@/components/brand/stamp";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { PushPrompt } from "@/components/push/push-prompt";
import { MailboxSettings } from "@/components/relations/mailbox-settings";
import { EmptyState } from "@/components/ui/empty-state";
import { accentForGender } from "@/lib/accent";
import { cn } from "@/lib/cn";
import { publicPhotoUrl, requireRole } from "@/lib/relations/server";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Relations.mailbox" });
  return { title: t("title") };
}

/**
 * Le Courrier (SPEC §7, maquette Courrier.dc.html): the requests received, never the chosen
 * charge nor the result of the bet (rule 14). The Tableau des visites arrives with Phase 5.
 */
export default async function MailboxPage() {
  const { supabase, userId, profile } = await requireRole("bad");
  const t = await getTranslations("Relations.mailbox");
  const [{ data }, , { data: prefs }] = await Promise.all([
    supabase.rpc("get_mailbox"),
    supabase.rpc("mark_notifications_read", { p_types: ["request_received"] }),
    supabase
      .from("notification_preferences")
      .select("push_prompt_declined_at")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const rows = data ?? [];
  const pending = rows.filter((row) => row.status === "pending");
  const accepted = rows.filter((row) => row.status === "accepted");
  const open = profile.requests_open && !profile.is_paused;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-col items-center gap-1.5 text-center">
        <p className="font-stamp text-accent text-xs tracking-[0.25em]">{t("eyebrow")}</p>
        <h1 className="font-display text-3xl uppercase">{t("count", { count: pending.length })}</h1>
        <p className="text-grey flex items-center gap-2.5 text-[13px]">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 font-bold",
              open ? "text-green-bright" : "text-cream",
            )}
          >
            <span
              aria-hidden="true"
              className={cn("size-2 rounded-full", open ? "bg-green-bright" : "bg-cream")}
            />
            {profile.is_paused ? t("paused") : open ? t("open") : t("full")}
          </span>
          <span>
            {t("capUsage", { count: profile.pending_requests_count, cap: profile.requests_cap })}
          </span>
        </p>
      </header>

      {/* Notifications are offered after the first request accepted, never on arrival. */}
      {accepted.length > 0 ? (
        <PushPrompt declinedAt={prefs?.push_prompt_declined_at ?? null} />
      ) : null}

      {pending.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {pending.map((row) => (
            <li key={row.request_id}>
              <LocalizedLink
                href={`/courrier/${row.request_id}`}
                className="hover:border-accent bg-cream text-ink flex gap-3 rounded-md border border-[#2a2a2e] p-3"
              >
                <div className="relative flex h-[68px] w-14 shrink-0 items-end justify-center overflow-hidden rounded-[3px] bg-[#2a2a2e]">
                  {row.photo_small ? (
                    <Image
                      src={publicPhotoUrl(supabase, row.photo_small) ?? ""}
                      alt=""
                      fill
                      sizes="56px"
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <UserRound
                      aria-hidden="true"
                      className="text-cream/40 size-12"
                      strokeWidth={1.2}
                    />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div
                    className="flex justify-between gap-2"
                    data-accent={accentForGender(row.gender)}
                  >
                    <span className="font-bold">
                      {row.age !== null
                        ? t("nameAge", { pseudo: row.pseudo, age: row.age })
                        : row.pseudo}
                    </span>
                    {row.complicity !== null ? (
                      <span className="font-display text-[var(--color-accent-ink)]">
                        {t("percent", { score: row.complicity })}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {row.clean_record ? (
                      <span className="text-green-ink rounded-full bg-[#dcefe3] px-2 py-0.5 text-[11px] font-bold">
                        {t("cleanRecord")}
                      </span>
                    ) : null}
                    <span className="rounded-full bg-[#e8e0cf] px-2 py-0.5 text-[11px] font-bold text-[#4a4038]">
                      {row.visits_due > 0
                        ? t("honored", { honored: row.visits_honored, due: row.visits_due })
                        : t("newVisitor")}
                    </span>
                  </div>
                  <p className="truncate text-[13px] text-[#4a4038]">
                    {row.note ? `« ${row.note} »` : t("noNote")}
                  </p>
                </div>
              </LocalizedLink>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Mail className="size-8" />}
          title={t("emptyTitle")}
          body={open ? t("emptyBody") : t("emptyClosed")}
        />
      )}

      {accepted.length > 0 ? (
        <section aria-labelledby="accepted-title" className="flex flex-col gap-2.5">
          <h2 id="accepted-title" className="font-display text-lg uppercase">
            {t("acceptedTitle")}
          </h2>
          <p className="text-grey text-sm">{t("acceptedHint")}</p>
          <ul className="flex flex-col gap-2">
            {accepted.map((row) => (
              <li key={row.request_id}>
                <LocalizedLink
                  href={`/courrier/${row.request_id}`}
                  data-accent={accentForGender(row.gender)}
                  className="border-line hover:border-accent flex min-h-14 items-center justify-between gap-3 rounded-md border px-3.5 py-2.5"
                >
                  <span className="text-accent font-bold">{row.pseudo}</span>
                  <Stamp kind="visitAccepted" surface="dark" size="sm" tilt={-4} />
                </LocalizedLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="border-line bg-ink-2 rounded-md border">
        <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">
          {t("settings")}
        </summary>
        <div className="border-t border-[var(--color-line)] p-4">
          <MailboxSettings cap={profile.requests_cap} closed={profile.requests_closed_manual} />
        </div>
      </details>
    </div>
  );
}
