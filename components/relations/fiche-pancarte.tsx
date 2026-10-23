"use client";

import { ChevronLeft, ChevronRight, RefreshCw, UserRound, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mugshot } from "@/components/brand/mugshot";
import { RequestModal } from "@/components/relations/request-modal";
import { buttonClasses } from "@/components/ui/button";
import { accentForGender } from "@/lib/accent";
import { cn } from "@/lib/cn";
import type { PrompterInput } from "@/lib/prompter";
import { abridge, type FicheAction } from "@/lib/relations/fiche-action";
import { type FicheView, tribeText } from "@/lib/relations/types";

type PhotoUrls = Record<number, { url: string; cutout: boolean } | null>;

/** Display order of the wall: left profile, face (in the middle, wider), right profile. */
const POSES = [
  { position: 1, key: "poseLeft", grow: "flex-1" },
  { position: 0, key: "poseFace", grow: "flex-[1.4]" },
  { position: 2, key: "poseRight", grow: "flex-1" },
] as const;

function archetypeKey(gender: FicheView["gender"]) {
  return gender === "woman" ? "badGirl" : gender === "man" ? "badBoy" : "bad";
}

/**
 * The 3 poses full screen (native dialog: focus kept inside, Escape closes). Swiping moves from
 * one pose to the next (scroll snap); the buttons and the arrow keys do the same.
 */
function PoseViewer({
  poses,
  start,
  title,
  onClose,
}: {
  poses: { url: string; cutout: boolean; alt: string }[];
  start: number;
  title: string;
  onClose: () => void;
}) {
  const t = useTranslations("Relations.pancarte");
  const dialog = useRef<HTMLDialogElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    const list = strip.current;
    if (list) list.scrollLeft = start * list.clientWidth;
  }, [start]);

  function go(next: number) {
    const list = strip.current;
    const target = Math.max(0, Math.min(poses.length - 1, next));
    if (list) list.scrollTo({ left: target * list.clientWidth, behavior: "smooth" });
    setIndex(target);
  }

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") go(index + 1);
        if (event.key === "ArrowLeft") go(index - 1);
      }}
      className="text-cream m-0 h-dvh max-h-none w-screen max-w-none bg-[#0a0a0c] p-0 backdrop:bg-black"
      data-testid="pose-viewer"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <p aria-live="polite" className="font-stamp text-sm tracking-widest">
            {t("counter", { index: index + 1, total: poses.length })}
          </p>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="bg-cream text-ink focus-visible:outline-accent inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 font-semibold focus-visible:outline-3"
          >
            <X aria-hidden="true" className="size-4" />
            {t("close")}
          </button>
        </div>
        <div
          ref={strip}
          // Reachable by keyboard (a scrolling region), the arrows move from pose to pose.
          tabIndex={0}
          role="region"
          aria-label={title}
          onScroll={(event) => {
            const list = event.currentTarget;
            setIndex(Math.round(list.scrollLeft / Math.max(1, list.clientWidth)));
          }}
          className="flex flex-1 snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overscroll-contain"
        >
          {poses.map((pose) => (
            <figure
              key={pose.url}
              className="flex w-full shrink-0 snap-center flex-col items-center justify-center gap-2 px-3"
            >
              <Mugshot
                src={pose.url}
                alt={pose.alt}
                cutout={pose.cutout}
                className="aspect-[4/5] w-[min(100%,calc(78dvh*0.8))] rounded-sm"
              />
              <figcaption className="font-stamp text-sm">{pose.alt}</figcaption>
            </figure>
          ))}
        </div>
        <div className="flex justify-center gap-4 px-3 py-3">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label={t("previous")}
            className="border-cream/70 inline-flex size-12 items-center justify-center rounded-full border-2 disabled:opacity-40"
          >
            <ChevronLeft aria-hidden="true" className="size-6" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={index === poses.length - 1}
            aria-label={t("next")}
            className="border-cream/70 inline-flex size-12 items-center justify-center rounded-full border-2 disabled:opacity-40"
          >
            <ChevronRight aria-hidden="true" className="size-6" />
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * A Bad's Fiche (owner's decision 2026-10-23, docs/design/parcours/FichePancarte.dc.html): the
 * 3 poses side by side on the graduated wall, the face in the middle, and in front of their
 * bottom a black placard with white letters on two rods. Its front is the file (N° d'écrou,
 * pseudo in the colour of the Bad's gender, archetype, age, quartier, signs, what the Bad looks
 * for, the behaviour note abridged, status); « Chefs d'accusation » turns only the placard over.
 * Its back holds the 3 charges: a radio group to bet on the true one when the Visitor may ask
 * for a visit, a plain list otherwise (the Bad's own Fiche). The bet is only kept on this page
 * and handed to the Demande de parloir: nothing of it is recorded before the request is sent.
 * Never the birth date, a real name, a height, nor the true line of the Casier (SPEC §5).
 * Reading order: the photos, the front, then the back (the hidden side is inert).
 */
export function FichePancarte({
  fiche,
  photos,
  action,
  souffleur,
  back,
  safety,
  status,
}: {
  fiche: FicheView;
  photos: PhotoUrls;
  action: FicheAction;
  /** The Souffleur's material, when the Visitor may ask for a visit. */
  souffleur: PrompterInput | null;
  /** The link back (Promenade, Ma Fiche), in the row of the complicity. */
  back: ReactNode;
  /** Signaler and Bloquer, under the button. */
  safety: ReactNode;
  /** The explanation shown instead of the button (cooldown, Permis waiting, own Fiche…). */
  status: string | null;
}) {
  const t = useTranslations("Relations.pancarte");
  const locale = useLocale();
  const accent = accentForGender(fiche.gender);
  const [flipped, setFlipped] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const turnButton = useRef<HTMLButtonElement>(null);
  const backSide = useRef<HTMLElement>(null);
  const openers = useRef<(HTMLButtonElement | null)[]>([]);
  const betting = action.kind === "request" && fiche.charges.length === 3;

  function turn(next: boolean) {
    setFlipped(next);
    // The side that was read becomes inert: the focus goes to the other one.
    requestAnimationFrame(() => (next ? backSide.current : turnButton.current)?.focus());
  }

  const poses = POSES.map((pose) => ({
    ...pose,
    photo: photos[pose.position] ?? null,
    alt: t(pose.key, { pseudo: fiche.pseudo }),
  }));
  const shown = poses.flatMap((pose) =>
    pose.photo ? [{ url: pose.photo.url, cutout: pose.photo.cutout, alt: pose.alt }] : [],
  );
  const place =
    fiche.city && fiche.distance_km !== null
      ? t("placeDistance", { city: fiche.city, km: fiche.distance_km })
      : fiche.city;
  const identity = [
    t(archetypeKey(fiche.gender)),
    fiche.age !== null ? t("years", { age: fiche.age }) : null,
    place,
  ]
    .filter(Boolean)
    .join(" · ");
  const signs = fiche.tribes.map((tribe) => tribeText(tribe, locale)).join(" · ");
  const seeking = fiche.seeking_genders.map((gender) => t(`seeking_${gender}`)).join(", ");

  return (
    <div className="flex flex-col gap-3">
      {/* What represents the Bad takes the Bad's colour; the bar below keeps the member's. */}
      <div data-accent={accent} className="@container mx-auto w-full max-w-[40rem]">
        <article
          aria-label={t("label", { pseudo: fiche.pseudo })}
          data-testid="fiche"
          className="flex flex-col"
        >
          <div className="flex items-center justify-between gap-3">
            {back}
            {/* No complicity with oneself. */}
            {action.kind === "self" ? null : (
              <p className="font-stamp text-[max(12px,3.2cqw)] tracking-[0.15em] text-[#b8ae9c] uppercase">
                {fiche.complicity !== null
                  ? t("complicity", { score: fiche.complicity })
                  : t("complicityUnknown")}
              </p>
            )}
          </div>

          <div className="relative mt-1">
            <section
              aria-label={t("photos", { pseudo: fiche.pseudo })}
              className="border-ink flex h-[82cqw] border-[3px]"
            >
              {poses.map((pose, index) => (
                <div
                  key={pose.position}
                  className={cn(
                    "mugshot-wall relative overflow-hidden",
                    pose.grow,
                    index === 1 && "border-ink border-x-2",
                  )}
                >
                  {pose.photo ? (
                    <button
                      type="button"
                      ref={(element) => {
                        openers.current[index] = element;
                      }}
                      onClick={() =>
                        setViewer(shown.findIndex((item) => item.url === pose.photo?.url))
                      }
                      className="focus-visible:outline-accent absolute inset-0 cursor-zoom-in focus-visible:outline-3 focus-visible:-outline-offset-4"
                    >
                      <Mugshot
                        src={pose.photo.url}
                        alt={pose.alt}
                        cutout={pose.photo.cutout}
                        priority
                        fill
                        top
                      />
                      <span className="sr-only"> {t("enlarge")}</span>
                    </button>
                  ) : (
                    <UserRound
                      role="img"
                      aria-label={pose.alt}
                      className="absolute inset-x-0 top-[6%] mx-auto h-3/5 w-4/5 text-[#26262a]"
                      strokeWidth={1.2}
                    />
                  )}
                </div>
              ))}
            </section>
            {fiche.good_conduct ? (
              <p className="font-display absolute top-[2cqw] right-[2cqw] rotate-[8deg] rounded-md border-[3px] border-[#e0233f] bg-[#efe6d2]/90 px-[2cqw] py-[1cqw] text-[max(11px,3.2cqw)] leading-none text-[#b5172e]">
                <span className="sr-only">{t("goodConduct")}</span>
                <span aria-hidden="true">
                  {t("goodConductLine1")}
                  <br />
                  {t("goodConductLine2")}
                </span>
              </p>
            ) : null}

            {/* The placard, in front of the bottom of the photos, on its two rods. */}
            <div className="placard-scene relative mx-[5cqw] -mt-[25cqw]">
              <div aria-hidden="true" className="flex h-0 justify-between px-[15cqw]">
                <span className="-mt-[6cqw] h-[6cqw] w-[3px] bg-[#8e8e94]" />
                <span className="-mt-[6cqw] h-[6cqw] w-[3px] bg-[#8e8e94]" />
              </div>
              <div className="placard" data-flipped={flipped ? "" : undefined}>
                <section
                  aria-label={t("front")}
                  inert={flipped}
                  aria-hidden={flipped || undefined}
                  className="placard-side placard-board placard-letters flex flex-col gap-[1.8cqw] px-[3.8cqw] py-[3.2cqw]"
                >
                  <p className="flex items-baseline justify-between gap-2 text-[max(11px,3cqw)] tracking-[0.2em] text-[#c9c3b8]">
                    <span>{t("caseFile")}</span>
                    <span>{t("ecrou", { ecrou: fiche.ecrou ?? "—" })}</span>
                  </p>
                  <h1 className="text-[max(22px,7.6cqw)] leading-none tracking-[0.1em] break-words text-[var(--color-accent-board)]">
                    {fiche.pseudo}
                  </h1>
                  <p className="text-[max(13px,3.8cqw)]">{identity}</p>
                  <p className="text-[max(12px,3.3cqw)] tracking-[0.1em] text-[#dcd6ca]">
                    {signs ? t("signs", { list: signs }) : t("noSigns")}
                  </p>
                  <p className="text-[max(12px,3.3cqw)] tracking-[0.1em] text-[#dcd6ca]">
                    {t("seeking", {
                      genders: seeking,
                      min: fiche.seek_age_min,
                      max: fiche.seek_age_max,
                    })}
                  </p>
                  <p className="text-[max(12px,3cqw)] leading-snug tracking-[0.06em] text-[#c9c3b8] normal-case">
                    {fiche.bio ? t("note", { text: abridge(fiche.bio) }) : t("noBio")}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[#3a3a40] pt-[1.6cqw]">
                    <p className="text-[max(11px,3cqw)] tracking-[0.1em]">
                      <span className={fiche.requests_open ? "text-[#8ee2b0]" : "text-[#dcd6ca]"}>
                        {fiche.requests_open ? t("open") : t("full")}
                      </span>
                      {fiche.recruited > 0 ? (
                        <span className="block text-[#c9c3b8]">
                          {t("recruited", { count: fiche.recruited })}
                        </span>
                      ) : null}
                    </p>
                    <button
                      ref={turnButton}
                      type="button"
                      onClick={() => turn(true)}
                      className="text-ink focus-visible:outline-accent inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--color-accent-board)] px-4 text-[max(13px,3.5cqw)] font-extrabold tracking-normal normal-case [text-shadow:none] focus-visible:outline-3 focus-visible:outline-offset-2"
                    >
                      <RefreshCw aria-hidden="true" className="size-4" strokeWidth={2.4} />
                      {t("turn")}
                    </button>
                  </div>
                </section>

                <section
                  ref={backSide}
                  tabIndex={-1}
                  aria-labelledby="pancarte-charges"
                  inert={!flipped}
                  aria-hidden={!flipped || undefined}
                  className="placard-side placard-back placard-board placard-letters flex flex-col gap-[1.8cqw] px-[3.8cqw] py-[3.2cqw] focus:outline-none"
                >
                  {betting ? (
                    <fieldset className="flex flex-col gap-[1.6cqw]">
                      <legend className="mb-[1.6cqw] flex w-full items-baseline justify-between gap-2">
                        <span
                          id="pancarte-charges"
                          className="text-[max(13px,3.6cqw)] text-[var(--color-accent-board)]"
                        >
                          {t("charges")}
                        </span>
                        <span className="text-[max(11px,3cqw)] text-[#c9c3b8]">
                          <span className="sr-only"> · </span>
                          {t("oneTrue")}
                        </span>
                      </legend>
                      {fiche.charges.map((charge, index) => {
                        const value = index + 1;
                        const checked = pick === value;
                        return (
                          <label
                            key={charge}
                            className={cn(
                              "has-focus-visible:outline-accent flex cursor-pointer items-start gap-[2.4cqw] rounded-[2px] border px-[2.2cqw] py-[1.8cqw] has-focus-visible:outline-3 has-focus-visible:outline-offset-2",
                              checked ? "border-[var(--color-accent-board)]" : "border-[#4a4a50]",
                            )}
                          >
                            <input
                              type="radio"
                              name="pari"
                              value={value}
                              checked={checked}
                              onChange={() => setPick(value)}
                              className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent-board)]"
                            />
                            <span className="text-[max(12px,3.3cqw)] leading-snug font-bold tracking-[0.04em] normal-case">
                              <span className="sr-only">
                                {t("chargeNumber", { number: value })}
                              </span>
                              <span aria-hidden="true">{value}. </span>
                              {charge}
                            </span>
                          </label>
                        );
                      })}
                    </fieldset>
                  ) : (
                    <>
                      <h2 className="flex items-baseline justify-between gap-2">
                        <span
                          id="pancarte-charges"
                          className="text-[max(13px,3.6cqw)] text-[var(--color-accent-board)]"
                        >
                          {t("charges")}
                        </span>
                        <span className="text-[max(11px,3cqw)] text-[#c9c3b8]">
                          <span className="sr-only"> · </span>
                          {t("oneTrue")}
                        </span>
                      </h2>
                      <ol className="flex flex-col gap-[1.6cqw]">
                        {fiche.charges.map((charge, index) => (
                          <li
                            key={charge}
                            className="rounded-[2px] border border-[#4a4a50] px-[2.2cqw] py-[1.8cqw] text-[max(12px,3.3cqw)] leading-snug font-bold tracking-[0.04em] normal-case"
                          >
                            <span aria-hidden="true">{index + 1}. </span>
                            {charge}
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  {fiche.casier_changed_since_request ? (
                    <p className="text-[max(11px,3cqw)] text-[#dcd6ca] normal-case">
                      {t("casierChanged")}
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <p className="text-[max(11px,2.8cqw)] tracking-[0.06em] text-[#c9c3b8]">
                      {betting ? t("betHint") : null}
                    </p>
                    <button
                      type="button"
                      onClick={() => turn(false)}
                      className="focus-visible:outline-accent inline-flex min-h-11 items-center rounded-full border border-[#c9c3b8] px-4 text-[max(12px,3.3cqw)] font-bold tracking-normal normal-case focus-visible:outline-3 focus-visible:outline-offset-2"
                    >
                      {t("turnBack")}
                    </button>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </article>
      </div>

      <FicheBar
        fiche={fiche}
        action={action}
        souffleur={souffleur}
        pick={pick}
        onPick={setPick}
        onBetFirst={() => turn(true)}
        status={status}
        safety={safety}
      />

      {viewer !== null && viewer >= 0 ? (
        <PoseViewer
          poses={shown}
          start={viewer}
          title={t("photos", { pseudo: fiche.pseudo })}
          onClose={() => {
            const opener = poses.findIndex((pose) => pose.photo?.url === shown[viewer]?.url);
            setViewer(null);
            openers.current[opener]?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/** The bottom of the Fiche: the request with the bet, or why there is none. */
function FicheBar({
  fiche,
  action,
  souffleur,
  pick,
  onPick,
  onBetFirst,
  status,
  safety,
}: {
  fiche: FicheView;
  action: FicheAction;
  souffleur: PrompterInput | null;
  pick: number | null;
  onPick: (value: number) => void;
  onBetFirst: () => void;
  status: string | null;
  safety: ReactNode;
}) {
  const t = useTranslations("Relations.pancarte");
  const big = buttonClasses("primary", "lg", "font-display w-full rounded-[4px] text-xl uppercase");
  let main: ReactNode = null;
  if (action.kind === "request" && souffleur && fiche.charges.length === 3) {
    main =
      pick !== null ? (
        <RequestModal
          badId={fiche.id}
          accent={accentForGender(fiche.gender)}
          pseudo={fiche.pseudo}
          charges={fiche.charges}
          souffleur={souffleur}
          guess={pick}
          onGuess={onPick}
        />
      ) : (
        <button
          type="button"
          onClick={onBetFirst}
          className="border-line text-cream/90 hover:border-cream/60 focus-visible:outline-accent flex min-h-13 w-full items-center justify-center rounded-[4px] border-2 px-4 text-center text-sm font-semibold focus-visible:outline-3"
        >
          {t("betFirst")}
        </button>
      );
  } else if (action.kind === "sent") {
    main = (
      <button type="button" disabled className={big}>
        {t("sent")}
      </button>
    );
  } else if (action.kind === "full") {
    main = (
      <>
        <button type="button" disabled aria-describedby="fiche-full-hint" className={big}>
          {t("fullButton")}
        </button>
        <p id="fiche-full-hint" className="text-grey text-center text-xs">
          {t("fullHint")}
        </p>
      </>
    );
  }
  if (!main && !status && !safety) return null;
  return (
    <div
      className="border-line bg-ink sticky bottom-14 z-20 -mx-2.5 flex flex-col gap-1.5 border-t px-4 pt-3 pb-1 sm:mx-auto sm:w-full sm:max-w-[40rem] sm:rounded-md sm:border"
      data-testid="fiche-action"
      data-action={action.kind}
    >
      {main}
      {status ? (
        <p
          role="status"
          className="border-line text-cream/90 rounded-md border px-4 py-3 text-center text-sm font-semibold"
        >
          {status}
        </p>
      ) : null}
      {safety}
    </div>
  );
}
