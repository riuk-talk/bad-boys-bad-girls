import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { MemberDetail } from "@/lib/admin/members";
import { shownMissing } from "@/lib/onboarding/missing";

type Props = {
  detail: MemberDetail;
  /** Signed (pending) or public (validated) thumbnail of each photo, by position. */
  thumbnails: Record<number, string>;
};

const POSES = ["face", "left", "right"] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
      <dt className="text-grey text-sm font-semibold">{label}</dt>
      <dd className="whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

/**
 * The full record of a member (10d), read only: identity, criteria, texts, Casier (the 3 charges,
 * never which one is true: règle 14), answers, photos and their status, consents, last visit,
 * what the dossier lacks, and whether the Bad is in the Découverte or why not.
 */
export async function MemberDossier({ detail, thumbnails }: Props) {
  const t = await getTranslations("Admin.dossier");
  const admin = await getTranslations("Admin");
  const items = await getTranslations("Onboarding.dossier.items");
  const genders = await getTranslations("Criteria.genders");
  const greffe = await getTranslations("Greffe");
  const format = await getFormatter();
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  const when = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" }) : "—";
  const none = t("none");
  const missing = shownMissing(detail.missing, detail.role);

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
              : missing.length === 0
                ? detail.state === "onboarding"
                  ? t("readyToFinish")
                  : t("complete")
                : t("missing")}
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

      <section aria-labelledby="identity-title" className="space-y-2">
        <h2 id="identity-title" className="font-display text-2xl uppercase">
          {t("identity")}
        </h2>
        <dl className="divide-line divide-y">
          <Row label={t("gender")}>
            {detail.gender ? genders(detail.gender as "man") : none}
          </Row>
          <Row label={t("age")}>{detail.age ?? none}</Row>
          <Row label={t("place")}>
            {[detail.city, detail.zone].filter(Boolean).join(" · ") || none}
          </Row>
          <Row label={t("seeking")}>
            {detail.seeking_genders.length > 0
              ? t("seekingValue", {
                  genders: detail.seeking_genders.map((g) => genders(g as "man")).join(", "),
                  min: detail.seek_age_min ?? 18,
                  max: detail.seek_age_max ?? 99,
                })
              : none}
          </Row>
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
          <Row label={t("answers")}>{detail.answers}</Row>
          <Row label={t("created")}>{when(detail.account_created_at)}</Row>
          <Row label={t("confirmed")}>{when(detail.email_confirmed_at)}</Row>
          <Row label={t("lastSignIn")}>{when(detail.last_sign_in_at)}</Row>
          <Row label={t("lastSeen")}>{when(detail.last_seen_at)}</Row>
        </dl>
      </section>

      <section aria-labelledby="photos-title" className="space-y-3">
        <h2 id="photos-title" className="font-display text-2xl uppercase">
          {t("photos")}
        </h2>
        {detail.photos.length === 0 ? <p className="text-grey">{t("noPhotos")}</p> : null}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {detail.photos.map((photo) => {
            const pose = POSES[photo.position];
            const label = pose
              ? greffe(`positions.${pose}`)
              : greffe("positions.extra", { number: photo.position + 1 });
            const src = thumbnails[photo.position];
            return (
              <li key={photo.position} className="border-line space-y-2 rounded-lg border p-2">
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
      </section>

      <section aria-labelledby="consents-title" className="space-y-3">
        <h2 id="consents-title" className="font-display text-2xl uppercase">
          {t("consents")}
        </h2>
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
      </section>
      <p className="text-grey text-xs">{admin("member.logged")}</p>
    </>
  );
}
