import { Check, UserRound } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Mugshot } from "@/components/brand/mugshot";
import { accentForGender } from "@/lib/accent";
import { cn } from "@/lib/cn";
import { type FicheView, localize, tribeText } from "@/lib/relations/types";

type PhotoUrls = Record<number, { url: string; cutout: boolean } | null>;

/** « Bad girl » / « Bad boy » / « Bad » (the archetype follows the gender). */
function archetypeKey(gender: FicheView["gender"]) {
  return gender === "woman" ? "badGirl" : gender === "man" ? "badBoy" : "bad";
}

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="font-display text-ink self-start border-b-[0.3cqw] border-[var(--color-accent-ink)] pb-[0.2cqw] text-[2.1cqw] leading-none uppercase"
    >
      {children}
    </h2>
  );
}

function Row({
  label,
  children,
  last = false,
}: {
  label: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div className={cn("flex gap-[0.6cqw] py-[0.45cqw]", !last && "border-b border-[#a89c86]")}>
      <dt className="font-display w-[34%] shrink-0 pt-[0.15cqw] text-[1.25cqw] text-[#2a2622] uppercase">
        {label}
      </dt>
      <dd className="text-ink min-w-0 text-[1.4cqw] font-bold">{children}</dd>
    </div>
  );
}

/** One of the 3 poses, on the wall of the site (cut out), the graduations as a fallback. */
function Pose({
  photo,
  alt,
  className,
}: {
  photo: { url: string; cutout: boolean } | null;
  alt: string;
  className: string;
}) {
  return (
    <div className={cn("absolute overflow-hidden", className)}>
      {photo ? (
        <Mugshot src={photo.url} alt={alt} cutout={photo.cutout} priority fill />
      ) : (
        <div className="mugshot-wall absolute inset-0 flex items-end justify-center">
          <UserRound
            role="img"
            aria-label={alt}
            className="h-4/5 w-4/5 text-[#26262a]"
            strokeWidth={1.2}
          />
        </div>
      )}
    </div>
  );
}

const RULER = ["200", "190", "180", "170", "160", "150", "140"];

/**
 * The Bad's Fiche as the judicial file of the reference (docs/design/reference-dossier-judiciaire.jpg,
 * PARCOURS-DESIGN §2): one landscape sheet whose sizes follow its own width (container units), the
 * same everywhere; on a phone held upright it is shown in miniature and opens in full
 * (components/relations/dossier-viewer.tsx). Left column: Identité du sujet, Chefs d'accusation,
 * Profil rencontre, round stamp, Note comportementale. Middle: Signes distinctifs. Right: the 3
 * poses cut out on the height chart and the observation line. Never the birth date, a real name, a
 * height, nor the true line of the Casier.
 */
export async function Dossier({ fiche, photos }: { fiche: FicheView; photos: PhotoUrls }) {
  const t = await getTranslations("Relations.dossier");
  const locale = await getLocale();
  const accent = accentForGender(fiche.gender);
  const archetype = t(archetypeKey(fiche.gender));
  const year = fiche.on_file_since.slice(0, 4);
  const since = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(`${fiche.on_file_since}-01T12:00:00Z`),
  );
  const observations = fiche.tribes
    .map((tribe) => (tribe.detail ? tribe.detail : localize(tribe.label, locale)))
    .join(" · ");
  const seeking = fiche.seeking_genders.map((gender) => t(`seeking_${gender}`)).join(", ");
  const place =
    fiche.city && fiche.distance_km !== null
      ? t("placeDistance", { city: fiche.city, km: fiche.distance_km })
      : (fiche.city ?? "—");

  return (
    <div className="@container">
      <article
        data-accent={accent}
        aria-label={t("label", { pseudo: fiche.pseudo })}
        data-testid="dossier"
        className="flex flex-col border-[0.8cqw] border-[#1a1a1a] bg-[#121212] shadow-[inset_0_0_0_2px_#2a2a2a]"
      >
        <header className="relative flex items-start justify-between gap-[2cqw] px-[2cqw] pt-[1.6cqw] pb-[1.2cqw]">
          <div>
            <h1 className="font-display text-ink inline-block bg-[#efe6d2] px-[1cqw] py-[0.2cqw] text-[4.6cqw] leading-[1.05] uppercase">
              {t("title")}
            </h1>
            <p className="font-display text-accent mt-[0.6cqw] text-[1.5cqw] tracking-[0.2em]">
              {t("subtitle", {
                version: t(`version_${fiche.gender}`),
                archetype: archetype.toUpperCase(),
                year,
              })}
            </p>
          </div>
          {fiche.good_conduct ? (
            <div className="text-accent flex h-[9cqw] w-[11cqw] shrink-0 rotate-[7deg] flex-col items-center justify-center rounded-[1.2cqw_1.2cqw_4cqw_4cqw] border-[0.35cqw] border-current">
              <Check aria-hidden="true" className="size-[2cqw]" strokeWidth={3} />
              <span className="font-display text-center text-[2cqw] leading-none">
                {t("goodConductLine1")}
                <br />
                {t("goodConductLine2")}
              </span>
            </div>
          ) : null}
        </header>

        <div className="dossier-paper grid grid-cols-[30fr_70fr] gap-x-[2.2cqw] px-[2cqw] py-[1.8cqw]">
          {/* Left column: identity, charges, dating profile, round stamp, behaviour note. */}
          <div className="flex flex-col gap-[1.6cqw]">
            <section aria-labelledby="dossier-identity" className="flex flex-col gap-[0.6cqw]">
              <SectionTitle id="dossier-identity">{t("identity")}</SectionTitle>
              <dl className="flex flex-col">
                <Row label={t("name")}>
                  <span className="font-display font-normal">: {t("confidential")}</span>
                </Row>
                <Row label={t("nickname")}>
                  <span className="text-[var(--color-accent-ink)]">: {fiche.pseudo}</span>
                </Row>
                <Row label={t("age")}>
                  : {fiche.age !== null ? t("years", { age: fiche.age }) : "—"}
                </Row>
                <Row label={t("quarter")}>: {place}</Row>
                <Row label={t("status")}>
                  <span className={fiche.requests_open ? "text-green-ink" : undefined}>
                    : {fiche.requests_open ? t("open") : t("full")}
                  </span>
                </Row>
                {fiche.recruited > 0 ? (
                  <Row label={t("accomplices")}>: {t("recruited", { count: fiche.recruited })}</Row>
                ) : null}
                <Row label={t("onFileSince")} last>
                  : {since}
                </Row>
              </dl>
            </section>

            <section aria-labelledby="dossier-charges" className="flex flex-col gap-[0.6cqw]">
              <div className="flex items-end justify-between gap-[0.6cqw]">
                <SectionTitle id="dossier-charges">{t("charges")}</SectionTitle>
                <span className="font-stamp text-[1.2cqw] text-[#2a2622]">{t("oneTrue")}</span>
              </div>
              <ol className="flex flex-col gap-[0.5cqw]">
                {fiche.charges.map((charge, index) => (
                  <li
                    key={charge}
                    className="border-ink flex gap-[0.8cqw] border-[0.2cqw] bg-white px-[0.8cqw] py-[0.5cqw]"
                  >
                    <span
                      aria-hidden="true"
                      className="font-display text-[1.9cqw] leading-none text-[var(--color-accent-ink)]"
                    >
                      {index + 1}
                    </span>
                    <span className="font-stamp text-ink text-[1.35cqw] leading-snug">
                      {charge}
                    </span>
                  </li>
                ))}
              </ol>
              {fiche.casier_changed_since_request ? (
                <p className="font-stamp text-[1.2cqw] text-[#2a2622]">{t("casierChanged")}</p>
              ) : null}
            </section>

            <section aria-labelledby="dossier-profile" className="flex flex-col gap-[0.6cqw]">
              <SectionTitle id="dossier-profile">{t("profile")}</SectionTitle>
              <dl className="flex flex-col">
                <Row label={t("archetype")}>
                  <span className="font-display font-normal text-[var(--color-accent-ink)] uppercase">
                    : {archetype}
                  </span>
                </Row>
                <Row label={t("seeking")}>
                  :{" "}
                  {t("seekingValue", {
                    genders: seeking,
                    min: fiche.seek_age_min,
                    max: fiche.seek_age_max,
                  })}
                </Row>
                <Row label={t("commonPoints")} last>
                  :{" "}
                  {fiche.common_points.length > 0
                    ? fiche.common_points.map((point) => localize(point.answer, locale)).join(" · ")
                    : t("noCommonPoints")}
                </Row>
              </dl>
            </section>

            <div className="flex flex-col items-center gap-[0.4cqw]">
              <div
                aria-hidden="true"
                className="font-display border-ink text-ink flex size-[11cqw] -rotate-10 flex-col items-center justify-center rounded-full border-[0.5cqw] border-double text-[1.5cqw] leading-none"
              >
                <span>{t("stampTop")}</span>
                <svg viewBox="0 0 24 24" className="my-[0.2cqw] size-[3cqw]" aria-hidden="true">
                  <circle cx="12" cy="10" r="7" fill="#0E0E10" />
                  <rect x="8.5" y="14" width="7" height="5" rx="1" fill="#0E0E10" />
                  <circle cx="9.3" cy="9.5" r="1.8" fill="#EFE6D2" />
                  <circle cx="14.7" cy="9.5" r="1.8" fill="#EFE6D2" />
                  <path d="M12 12.5l-1 1.5h2z" fill="#EFE6D2" />
                </svg>
                <span>{t("stampBottom")}</span>
              </div>
              <p className="font-display text-ink text-[1.15cqw] uppercase">{t("validated")}</p>
            </div>

            <section
              aria-labelledby="dossier-note"
              className="border-ink border-[0.3cqw] bg-[#efe6d2] px-[1cqw] py-[0.8cqw] shadow-[0.3cqw_0.3cqw_0_#0E0E10]"
            >
              <h2
                id="dossier-note"
                className="font-display text-ink mb-[0.3cqw] text-[1.6cqw] uppercase"
              >
                {t("behaviourNote")}
              </h2>
              <p className="font-stamp text-ink text-[1.3cqw] leading-relaxed">
                {fiche.bio || t("noBio")}
              </p>
            </section>
          </div>

          {/* Middle (signs) and right (the photo title), then the 3 poses under both. */}
          <div className="flex flex-col gap-[1.4cqw]">
            <div className="grid grid-cols-[19fr_51fr] gap-x-[2.2cqw]">
              <section aria-labelledby="dossier-signs" className="flex flex-col gap-[0.6cqw]">
                <SectionTitle id="dossier-signs">{t("signs")}</SectionTitle>
                {fiche.tribes.length > 0 ? (
                  <ul className="font-display text-ink list-disc pl-[1.6cqw] text-[1.4cqw] leading-relaxed">
                    {fiche.tribes.map((tribe) => (
                      <li key={tribeText(tribe, "fr")}>{tribeText(tribe, locale)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="font-stamp text-[1.3cqw] text-[#2a2622]">{t("noSigns")}</p>
                )}
              </section>

              <div className="self-end">
                <SectionTitle id="dossier-photos">{t("photos")}</SectionTitle>
              </div>
            </div>
            <section aria-labelledby="dossier-photos" className="flex flex-1 flex-col gap-[0.8cqw]">
              <div className="flex min-h-[32cqw] flex-1">
                <div className="mugshot-wall relative flex-1 overflow-hidden">
                  <Pose
                    photo={photos[1] ?? null}
                    alt={t("poseLeft", { pseudo: fiche.pseudo })}
                    className="border-ink inset-y-[8%] left-0 w-[34%] border-[0.2cqw]"
                  />
                  <Pose
                    photo={photos[2] ?? null}
                    alt={t("poseRight", { pseudo: fiche.pseudo })}
                    className="border-ink inset-y-[8%] right-0 w-[34%] border-[0.2cqw]"
                  />
                  <Pose
                    photo={photos[0] ?? null}
                    alt={t("poseFace", { pseudo: fiche.pseudo })}
                    className="border-ink inset-y-0 left-[27%] w-[46%] border-x-[0.25cqw]"
                  />
                </div>
                <div
                  aria-hidden="true"
                  className="font-display bg-ink flex w-[3.6cqw] flex-col justify-between py-[0.6cqw] text-center text-[1.1cqw] text-[#efe6d2]"
                >
                  {RULER.map((mark, index) => (
                    <span
                      key={mark}
                      className={
                        index === 3 || index === 5 ? "text-ink bg-[var(--color-accent)]" : undefined
                      }
                    >
                      {mark}
                    </span>
                  ))}
                </div>
              </div>
              <p className="font-display text-ink text-center text-[1.3cqw] tracking-wide uppercase">
                {t("observation", {
                  subject: t(`subject_${fiche.gender}`),
                  age: fiche.age ?? "—",
                  obs: observations || t("nothingToReport"),
                })}
              </p>
            </section>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-[2cqw] px-[2cqw] py-[1.2cqw]">
          <div
            aria-hidden="true"
            className="dossier-barcode h-[3.6cqw] w-[16cqw] shrink-0 border-[0.3cqw] border-[#efe6d2]"
          />
          <p className="font-display flex-1 text-center text-[1.35cqw] tracking-[0.15em] text-[#efe6d2]">
            {t("footer", { ecrou: fiche.ecrou ?? "—" })}
          </p>
          <p className="font-display text-accent shrink-0 text-[2.2cqw]">
            {fiche.complicity !== null
              ? t("complicity", { score: fiche.complicity })
              : t("complicityUnknown")}
          </p>
        </footer>
      </article>
    </div>
  );
}
