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

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-ink self-start border-b-[3px] border-[var(--color-accent-ink)] pb-0.5 text-[19px] leading-none uppercase">
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
    <div className={cn("flex gap-1.5 py-1", !last && "border-b border-[#a89c86]")}>
      <dt className="font-display w-[104px] shrink-0 pt-0.5 text-xs text-[#2a2622] uppercase">
        {label}
      </dt>
      <dd className="font-display text-ink min-w-0 text-[13px]">{children}</dd>
    </div>
  );
}

function Pose({
  photo,
  alt,
  side,
}: {
  photo: { url: string; cutout: boolean } | null;
  alt: string;
  side: "left" | "face" | "right";
}) {
  const frame = cn("border-ink border-2", side === "face" ? "flex-[1.35] border-x-0" : "flex-1");
  // The wall of the site behind a cut-out pose, the graduations over a pose kept as it is.
  return photo ? (
    <Mugshot src={photo.url} alt={alt} cutout={photo.cutout} priority className={frame} />
  ) : (
    <div
      className={cn("mugshot-wall relative flex items-end justify-center overflow-hidden", frame)}
    >
      <UserRound aria-hidden="true" className="h-4/5 w-4/5 text-[#26262a]" strokeWidth={1.2} />
    </div>
  );
}

/**
 * The Bad's Fiche as the judicial file of the reference (PARCOURS-DESIGN §2, maquettes Fiche and
 * FicheLarge). Never the birth date, a real name, a height, nor the true line of the Casier.
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

  const identity = (
    <section aria-labelledby="dossier-identity" className="flex flex-col gap-2">
      <SectionTitle>
        <span id="dossier-identity">{t("identity")}</span>
      </SectionTitle>
      <dl className="flex flex-col">
        <Row label={t("name")}>: {t("confidential")}</Row>
        <Row label={t("nickname")}>
          <span className="font-sans text-sm font-bold text-[var(--color-accent-ink)] normal-case">
            : {fiche.pseudo}
          </span>
        </Row>
        <Row label={t("age")}>
          <span className="font-sans text-sm font-bold normal-case">
            : {fiche.age !== null ? t("years", { age: fiche.age }) : "—"}
          </span>
        </Row>
        <Row label={t("quarter")}>
          <span className="font-sans text-sm font-bold normal-case">: {place}</span>
        </Row>
        <Row label={t("status")}>
          <span
            className={cn(
              "font-sans text-sm font-bold normal-case",
              fiche.requests_open ? "text-green-ink" : "text-ink",
            )}
          >
            : {fiche.requests_open ? t("open") : t("full")}
          </span>
        </Row>
        {fiche.recruited > 0 ? (
          <Row label={t("accomplices")}>
            <span className="font-sans text-sm font-bold normal-case">
              : {t("recruited", { count: fiche.recruited })}
            </span>
          </Row>
        ) : null}
        <Row label={t("onFileSince")} last>
          <span className="font-sans text-sm font-bold normal-case">: {since}</span>
        </Row>
      </dl>
    </section>
  );

  const photosBlock = (
    <section aria-labelledby="dossier-photos" className="flex flex-col gap-2.5">
      <SectionTitle>
        <span id="dossier-photos">{t("photos")}</span>
      </SectionTitle>
      <div className="flex h-44 lg:h-56">
        <Pose photo={photos[1] ?? null} alt={t("poseLeft", { pseudo: fiche.pseudo })} side="left" />
        <Pose photo={photos[0] ?? null} alt={t("poseFace", { pseudo: fiche.pseudo })} side="face" />
        <Pose
          photo={photos[2] ?? null}
          alt={t("poseRight", { pseudo: fiche.pseudo })}
          side="right"
        />
        <div
          aria-hidden="true"
          className="font-display bg-ink ml-1.5 flex w-[30px] flex-col justify-between py-1 text-center text-[10px] text-[#efe6d2]"
        >
          {["200", "180", "170", "160", "150", "140"].map((mark, index) => (
            <span
              key={mark}
              className={
                index === 2 || index === 4 ? "text-ink bg-[var(--color-accent)]" : undefined
              }
            >
              {mark}
            </span>
          ))}
        </div>
      </div>
      <p className="font-display text-ink text-[11px] tracking-wide uppercase">
        {t("observation", {
          subject: t(`subject_${fiche.gender}`),
          age: fiche.age ?? "—",
          obs: observations || t("nothingToReport"),
        })}
      </p>
    </section>
  );

  const signs = (
    <section aria-labelledby="dossier-signs" className="flex flex-col gap-2">
      <SectionTitle>
        <span id="dossier-signs">{t("signs")}</span>
      </SectionTitle>
      {fiche.tribes.length > 0 ? (
        <ul className="font-display text-ink list-disc pl-5 text-sm leading-relaxed">
          {fiche.tribes.map((tribe) => (
            <li key={tribeText(tribe, "fr")}>{tribeText(tribe, locale)}</li>
          ))}
        </ul>
      ) : (
        <p className="font-stamp text-sm text-[#2a2622]">{t("noSigns")}</p>
      )}
    </section>
  );

  const profile = (
    <section aria-labelledby="dossier-profile" className="flex flex-col gap-2">
      <SectionTitle>
        <span id="dossier-profile">{t("profile")}</span>
      </SectionTitle>
      <dl className="flex flex-col">
        <Row label={t("archetype")}>
          <span className="text-[var(--color-accent-ink)]">: {archetype}</span>
        </Row>
        <Row label={t("seeking")}>
          <span className="font-sans text-sm font-bold normal-case">
            :{" "}
            {t("seekingValue", {
              genders: seeking,
              min: fiche.seek_age_min,
              max: fiche.seek_age_max,
            })}
          </span>
        </Row>
        <Row label={t("commonPoints")} last>
          <span className="font-sans text-sm font-bold normal-case">
            :{" "}
            {fiche.common_points.length > 0
              ? fiche.common_points.map((point) => localize(point.answer, locale)).join(" · ")
              : t("noCommonPoints")}
          </span>
        </Row>
      </dl>
    </section>
  );

  const charges = (
    <section aria-labelledby="dossier-charges" className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-2">
        <SectionTitle>
          <span id="dossier-charges">{t("charges")}</span>
        </SectionTitle>
        <span className="font-stamp text-[11px] text-[#2a2622]">{t("oneTrue")}</span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {fiche.charges.map((charge, index) => (
          <li key={charge} className="border-ink flex gap-2.5 border-2 bg-white px-2.5 py-2">
            <span
              aria-hidden="true"
              className="font-display text-[19px] leading-none text-[var(--color-accent-ink)]"
            >
              {index + 1}
            </span>
            <span className="font-stamp text-ink text-sm leading-snug">{charge}</span>
          </li>
        ))}
      </ol>
      {fiche.casier_changed_since_request ? (
        <p className="font-stamp text-xs text-[#2a2622]">{t("casierChanged")}</p>
      ) : null}
    </section>
  );

  const note = (
    <div className="flex items-center gap-2.5">
      <div
        aria-hidden="true"
        className="font-display border-ink text-ink flex size-24 shrink-0 -rotate-10 flex-col items-center justify-center rounded-full border-4 border-double text-[13px] leading-none lg:size-32"
      >
        <span>{t("stampTop")}</span>
        <svg viewBox="0 0 24 24" className="my-0.5 size-6" aria-hidden="true">
          <circle cx="12" cy="10" r="7" fill="#0E0E10" />
          <rect x="8.5" y="14" width="7" height="5" rx="1" fill="#0E0E10" />
          <circle cx="9.3" cy="9.5" r="1.8" fill="#EFE6D2" />
          <circle cx="14.7" cy="9.5" r="1.8" fill="#EFE6D2" />
          <path d="M12 12.5l-1 1.5h2z" fill="#EFE6D2" />
        </svg>
        <span>{t("stampBottom")}</span>
      </div>
      <div className="border-ink flex-1 border-[3px] bg-[#efe6d2] px-2.5 py-2 shadow-[3px_3px_0_#0E0E10]">
        <p className="font-display text-ink mb-0.5 text-sm uppercase">{t("behaviourNote")}</p>
        <p className="font-stamp text-ink text-xs leading-relaxed">{fiche.bio || t("noBio")}</p>
        <p className="font-stamp mt-1 text-[11px] text-[#2a2622]">{t("validated")}</p>
      </div>
    </div>
  );

  return (
    <article
      data-accent={accent}
      aria-label={t("label", { pseudo: fiche.pseudo })}
      className="flex flex-col border-[6px] border-[#1a1a1a] bg-[#121212] shadow-[inset_0_0_0_2px_#2a2a2a] lg:border-[10px]"
    >
      <header className="relative px-3 pt-3 pb-2.5 lg:px-5 lg:pt-5">
        <h1 className="font-display text-ink inline-block max-w-[250px] bg-[#efe6d2] px-2 py-0.5 text-[26px] leading-[1.05] uppercase lg:max-w-none lg:text-4xl">
          {t("title")}
        </h1>
        <p className="font-display text-accent mt-1.5 text-xs tracking-[0.2em]">
          {t("subtitle", {
            version: t(`version_${fiche.gender}`),
            archetype: archetype.toUpperCase(),
            year,
          })}
        </p>
        {fiche.good_conduct ? (
          <div className="text-accent absolute top-3 right-2.5 flex h-[72px] w-[86px] rotate-[7deg] flex-col items-center justify-center rounded-[12px_12px_40px_40px] border-[3px] border-current lg:h-[120px] lg:w-[150px]">
            <Check aria-hidden="true" className="size-4" strokeWidth={3} />
            <span className="font-display text-center text-[13px] leading-none lg:text-xl">
              {t("goodConductLine1")}
              <br />
              {t("goodConductLine2")}
            </span>
          </div>
        ) : null}
      </header>

      <div className="dossier-paper flex flex-col gap-3 px-3 pt-3.5 pb-4 lg:grid lg:grid-cols-[minmax(0,370px)_minmax(0,1fr)_minmax(0,300px)] lg:gap-6 lg:px-5 lg:py-5">
        <div className="flex flex-col gap-3">
          {photosBlock}
          {identity}
        </div>
        <div className="flex flex-col gap-3">
          {signs}
          {profile}
          {charges}
        </div>
        <div className="flex flex-col gap-3 lg:justify-end">{note}</div>
      </div>

      <footer className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row-reverse lg:items-center lg:justify-between lg:px-5">
        <div className="flex items-center justify-between gap-3 lg:gap-6">
          <div
            aria-hidden="true"
            className="dossier-barcode h-8 w-[120px] border-[3px] border-[#efe6d2]"
          />
          <p className="font-display text-accent text-xl">
            {fiche.complicity !== null
              ? t("complicity", { score: fiche.complicity })
              : t("complicityUnknown")}
          </p>
        </div>
        <p className="font-display text-[11px] tracking-[0.15em] text-[#efe6d2]">
          {t("footer", { ecrou: fiche.ecrou ?? "—" })}
        </p>
      </footer>
    </article>
  );
}
