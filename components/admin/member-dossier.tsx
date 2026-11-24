import type { ReactNode } from "react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { RevealEmail } from "@/components/admin/reveal-email";
import { Link } from "@/i18n/navigation";
import type { MemberDetail, MemberExtra } from "@/lib/admin/members";
import { shownMissing } from "@/lib/onboarding/missing";

type Props = {
  detail: MemberDetail;
  /** 10i: the rest of the record (admin_member_extra); none for an account without a profile. */
  extra: MemberExtra | null;
  /** Signed (pending) or public (validated) thumbnail of each photo, by position. */
  thumbnails: Record<number, string>;
  /** members.email: « Afficher l'e-mail » (each showing logged). */
  canSeeEmail: boolean;
};

const POSES = ["face", "left", "right"] as const;
const PREFERENCES = [
  "push_requests",
  "push_visits",
  "push_messages",
  "push_promenade",
  "email_request_digest",
  "email_date_accepted",
  "email_visit_reminder",
  "email_permit_granted",
  "email_zone_opened",
  "email_dormant",
  "email_weekly",
] as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
      <dt className="text-grey text-sm font-semibold">{label}</dt>
      <dd className="whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

/** A section that folds (10i), open at first: nothing of the record is hidden by default. */
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <details open className="border-line group rounded-lg border" data-section={id}>
      <summary className="font-display flex min-h-12 cursor-pointer items-center px-4 text-2xl uppercase">
        <h2 id={`${id}-title`} className="inline">
          {title}
        </h2>
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  );
}

/**
 * The full record of a member, read only (10d, completed in 10i), in folding sections in this
 * order: Identité, Recherche, Fiche, Interrogatoire, Photos, Activité, Réglages, Consentements (the
 * page adds Historique). The Casier shows its 3 charges, never which one is true (règle 14).
 */
export async function MemberDossier({ detail, extra, thumbnails, canSeeEmail }: Props) {
  const t = await getTranslations("Admin.dossier");
  const admin = await getTranslations("Admin");
  const items = await getTranslations("Onboarding.dossier.items");
  const seekingGenders = await getTranslations("Criteria.genders");
  const genders = await getTranslations("Onboarding.identity.genders");
  const greffe = await getTranslations("Greffe");
  const format = await getFormatter();
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  const when = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" }) : "—";
  const day = (value: string | null) =>
    value ? format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: "long" }) : "—";
  const none = t("none");
  const missing = shownMissing(detail.missing, detail.role);
  const text = (value: Record<string, string> | null) =>
    value ? (value[locale] ?? value.fr ?? "") : none;
  const byStatus = (values: Record<string, number>) => {
    const entries = Object.entries(values);
    return entries.length === 0
      ? none
      : entries
          .map(([status, n]) => `${t(`requestStatus.${status as "pending"}`)} : ${n}`)
          .join(" · ");
  };

  return (
    <>
      <section aria-labelledby="dossier-title" className="space-y-3">
        <h2 id="dossier-title" className="font-display text-2xl uppercase">
          {t("title")}
        </h2>
        <div className="border-line rounded-lg border p-4">
          <p className="font-semibold">
            {detail.state === "not_started"
              ? t("notStarted")
              : detail.state === "onboarding"
                ? missing.length === 0
                  ? t("readyToFinish")
                  : t("missing")
                : missing.length === 0
                  ? t("complete")
                  : t("completeButMissing")}
          </p>
          {missing.length > 0 && detail.state !== "not_started" ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {missing.map((key) => (
                <li key={key}>{items(key)}</li>
              ))}
            </ul>
          ) : null}
          {detail.blocked ? <p className="text-accent mt-2 text-sm">{t("blocked")}</p> : null}
        </div>
        {detail.role === "bad" && detail.hidden_reasons ? (
          <div className="border-line rounded-lg border p-4">
            <p className="font-semibold">
              {detail.hidden_reasons.length === 0 ? t("visibleYes") : t("visibleNo")}
            </p>
            {detail.hidden_reasons.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {detail.hidden_reasons.map((reason) => (
                  <li key={reason}>{t(`hidden.${reason}`)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : detail.role === "visitor" ? (
          <p className="text-grey text-sm">{t("visibleVisitor")}</p>
        ) : null}
      </section>

      <Section id="identity" title={t("identity")}>
        <dl className="divide-line divide-y">
          <Row label={t("gender")}>{detail.gender ? genders(detail.gender as "man") : none}</Row>
          <Row label={t("birthdate")}>
            {extra?.birthdate
              ? t("birthdateValue", { date: day(extra.birthdate), age: detail.age ?? "—" })
              : (detail.age ?? none)}
          </Row>
          <Row label={t("ecrou")}>{extra?.ecrou ?? none}</Row>
          <Row label={t("role")}>
            {detail.role ? admin(`roles.${detail.role}`) : none}
            {extra?.role_changed_at
              ? ` · ${t("roleChanged", { date: when(extra.role_changed_at) })}`
              : null}
          </Row>
          <Row label={t("email")}>
            {canSeeEmail && detail.has_profile ? (
              <RevealEmail memberId={detail.id} />
            ) : (
              t("emailHidden")
            )}
          </Row>
          <Row label={t("place")}>
            {[detail.city, detail.zone].filter(Boolean).join(" · ") || none}
          </Row>
          <Row label={t("created")}>{when(detail.account_created_at)}</Row>
          <Row label={t("confirmed")}>{when(detail.email_confirmed_at)}</Row>
          <Row label={t("lastSignIn")}>{when(detail.last_sign_in_at)}</Row>
          <Row label={t("lastSeen")}>{when(detail.last_seen_at)}</Row>
        </dl>
      </Section>

      <Section id="search" title={t("search")}>
        <dl className="divide-line divide-y">
          <Row label={t("seeking")}>
            {detail.seeking_genders.length > 0
              ? t("seekingValue", {
                  genders: detail.seeking_genders.map((g) => seekingGenders(g as "man")).join(", "),
                  min: detail.seek_age_min ?? 18,
                  max: detail.seek_age_max ?? 99,
                })
              : none}
          </Row>
        </dl>
      </Section>

      <Section id="fiche" title={t("fiche")}>
        <dl className="divide-line divide-y">
          <Row label={detail.role === "visitor" ? t("motive") : t("bio")}>
            {(detail.role === "visitor" ? detail.visit_motive : detail.bio) ?? none}
          </Row>
          <Row label={t("tribes")}>
            {detail.tribes.length > 0
              ? detail.tribes
                  .map((tribe) => tribe.label[locale] + (tribe.detail ? ` (${tribe.detail})` : ""))
                  .join(", ")
              : none}
          </Row>
          {detail.role === "bad" ? (
            <Row label={t("casier")}>
              {detail.casier ? (
                <>
                  <ol className="list-decimal pl-5">
                    {detail.casier.map((charge, index) => (
                      <li key={index}>{charge}</li>
                    ))}
                  </ol>
                  <span className="text-grey text-sm">{t("casierSecret")}</span>
                </>
              ) : (
                none
              )}
            </Row>
          ) : null}
        </dl>
      </Section>

      <Section id="interrogation" title={t("interrogation")}>
        <p className="text-grey text-sm">{t("answersCount", { count: detail.answers })}</p>
        {extra && extra.answers.length > 0 ? (
          <ol className="divide-line divide-y">
            {extra.answers.map((answer, index) => (
              <li key={index} className="space-y-1 py-2">
                <p className="font-semibold">{text(answer.question)}</p>
                <p className="text-sm">{t("answerGiven", { answer: text(answer.answer) })}</p>
                <p className="text-sm">
                  {t("answerAccepted", {
                    answers: answer.accepted.map((value) => text(value)).join(", ") || none,
                  })}
                </p>
                <p className="text-grey text-sm">{t(`importance.${answer.importance}`)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-grey">{none}</p>
        )}
      </Section>

      <Section id="photos" title={t("photos")}>
        {detail.photos.length === 0 ? <p className="text-grey">{t("noPhotos")}</p> : null}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {detail.photos.map((photo, index) => {
            const pose = POSES[photo.position];
            const label = pose
              ? greffe(`positions.${pose}`)
              : greffe("positions.extra", { number: photo.position + 1 });
            const src = thumbnails[photo.position];
            return (
              <li key={index} className="border-line space-y-2 rounded-lg border p-2">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small thumbnail, signed (pending) or public (validated)
                  <img
                    src={src}
                    alt={t("photoAlt", { pose: label })}
                    className="aspect-[3/4] w-full rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="bg-ink-2 text-grey flex aspect-[3/4] items-center justify-center rounded text-sm">
                    {t("noFile")}
                  </div>
                )}
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-sm">
                  {t(`photoStatus.${photo.status}`)}
                  {photo.status === "rejected" && photo.rejection_reason
                    ? ` · ${greffe(`reasons.${photo.rejection_reason as "other"}`)}`
                    : null}
                  {photo.waived ? ` · ${t("waived")}` : null}
                </p>
                <p className="text-grey text-xs">{when(photo.created_at)}</p>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="activity" title={t("activity")}>
        {extra ? (
          <>
            <dl className="divide-line divide-y">
              <Row label={t("requestsSent")}>{byStatus(extra.activity.sent)}</Row>
              <Row label={t("requestsReceived")}>{byStatus(extra.activity.received)}</Row>
              <Row label={t("visits")}>
                {t("visitsValue", {
                  upcoming: extra.activity.visits_upcoming,
                  honored: extra.activity.visits_honored,
                  absent: extra.activity.visits_absent,
                })}
              </Row>
              <Row label={t("permits")}>{extra.activity.permits_open}</Row>
              <Row label={t("cavales")}>
                {t("cavalesValue", {
                  proposed: extra.activity.cavales_proposed,
                  accepted: extra.activity.cavales_accepted,
                })}
              </Row>
              <Row label={t("blocks")}>
                {t("madeReceived", {
                  made: extra.activity.blocks_made,
                  received: extra.activity.blocks_received,
                })}
              </Row>
              <Row label={t("reports")}>
                {t("madeReceived", {
                  made: extra.activity.reports_made,
                  received: extra.activity.reports_received,
                })}
                {extra.activity.reports_open > 0 ? (
                  <>
                    {" · "}
                    <Link href="/admin/signalements" className="underline underline-offset-4">
                      {t("reportsOpen", { count: extra.activity.reports_open })}
                    </Link>
                  </>
                ) : null}
              </Row>
              <Row label={t("sanctions")}>
                {extra.activity.sanctions.length === 0 ? (
                  none
                ) : (
                  <ul className="space-y-1">
                    {extra.activity.sanctions.map((sanction, index) => (
                      <li key={index}>
                        {admin(`actions.${sanction.action as "warn"}`)} ·{" "}
                        {when(sanction.created_at)}
                        {sanction.ends_at
                          ? ` · ${admin("member.until", { date: when(sanction.ends_at) })}`
                          : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Row>
            </dl>
            <h3 className="font-semibold">{t("lastRequests")}</h3>
            {extra.activity.last_requests.length === 0 ? (
              <p className="text-grey">{none}</p>
            ) : (
              <ul className="divide-line divide-y text-sm">
                {extra.activity.last_requests.map((request) => (
                  <li key={request.id} className="flex flex-wrap gap-x-3 py-2">
                    <span>{when(request.created_at)}</span>
                    <span>{t(`direction.${request.direction}`)}</span>
                    <Link
                      href={`/admin/membres/${request.other_id}`}
                      className="font-semibold underline underline-offset-4"
                    >
                      {request.other_pseudo ?? admin("noPseudo")}
                    </Link>
                    <span>{t(`requestStatus.${request.status as "pending"}`)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-grey">{none}</p>
        )}
      </Section>

      <Section id="settings" title={t("settings")}>
        {extra ? (
          <dl className="divide-line divide-y">
            <Row label={t("pause")}>
              {extra.settings.paused
                ? t("pausedSince", { date: when(extra.settings.paused_at) })
                : t("notPaused")}
            </Row>
            <Row label={t("cap")}>
              {t("capValue", {
                cap: extra.settings.requests_cap ?? "—",
                pending: extra.settings.pending_requests ?? 0,
              })}
              {extra.settings.requests_open === false ? ` · ${t("parloirFull")}` : null}
              {extra.settings.requests_closed_manual ? ` · ${t("closedManual")}` : null}
            </Row>
            <Row label={t("notifications")}>
              {extra.settings.notifications ? (
                <ul className="space-y-0.5 text-sm">
                  {PREFERENCES.filter((key) => key in (extra.settings.notifications ?? {})).map(
                    (key) => (
                      <li key={key}>
                        {t(`prefs.${key}`)} :{" "}
                        {extra.settings.notifications?.[key] === false ? t("off") : t("on")}
                      </li>
                    ),
                  )}
                </ul>
              ) : (
                t("defaults")
              )}
            </Row>
            <Row label={t("devices")}>{extra.settings.devices}</Row>
            <Row label={t("referral")}>
              {t("referralValue", {
                code: extra.settings.referral_code ?? "—",
                count: extra.settings.referrals,
              })}
            </Row>
          </dl>
        ) : (
          <p className="text-grey">{none}</p>
        )}
      </Section>

      <Section id="consents" title={t("consents")}>
        {detail.consents.length === 0 ? <p className="text-grey">{t("noConsents")}</p> : null}
        <ul className="divide-line divide-y text-sm">
          {detail.consents.map((consent, index) => (
            <li key={index} className="flex flex-wrap gap-x-3 py-2">
              <span className="font-semibold">{t(`consentTypes.${consent.type as "terms"}`)}</span>
              <span>{consent.granted ? t("granted") : t("withdrawn")}</span>
              <span className="text-grey">
                {when(consent.created_at)} · {consent.version}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/** Historique (10i, last section): identity changes; the page adds the moderation history. */
export async function IdentityHistory({ detail }: { detail: MemberDetail }) {
  const t = await getTranslations("Admin.dossier");
  const admin = await getTranslations("Admin");
  const format = await getFormatter();
  const when = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" }) : "—";
  return (
    <>
      <h3 className="font-semibold">{t("pseudoHistory")}</h3>
      {detail.pseudo_history.length === 0 ? <p className="text-grey">{t("none")}</p> : null}
      <ul className="space-y-1 text-sm">
        {detail.pseudo_history.map((change) => (
          <li key={change.changed_at}>
            {t("pseudoChange", {
              old: change.old_pseudo,
              new: change.new_pseudo,
              date: when(change.changed_at),
            })}
          </li>
        ))}
      </ul>
      {detail.birthdate_corrections.length > 0 ? (
        <>
          <h3 className="font-semibold">{t("corrections")}</h3>
          <ul className="space-y-1 text-sm">
            {detail.birthdate_corrections.map((c) => (
              <li key={c.id}>
                {t("correctionRow", {
                  status: admin(`corrections.status.${c.status}`),
                  date: when(c.created_at),
                  age: c.requested_age ?? "—",
                })}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
