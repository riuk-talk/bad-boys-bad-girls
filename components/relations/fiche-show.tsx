"use client";

import { Flag, Minimize2, UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { RequestModal } from "@/components/relations/request-modal";
import { accentForGender } from "@/lib/accent";
import { cn } from "@/lib/cn";
import type { PrompterInput } from "@/lib/prompter";
import type { FicheAction } from "@/lib/relations/fiche-action";
import { type FicheView, localize, tribeText } from "@/lib/relations/types";

type Photo = { url: string; cutout: boolean };
type PhotoUrls = Record<number, Photo | null>;

/** The 3 poses in the order of the wall at rest: left profile, face, right profile. */
const POSES = [
  { position: 1, key: "left" },
  { position: 0, key: "face" },
  { position: 2, key: "right" },
] as const;
/** The frames, left to right; the middle one is in front. They never move. */
const SLOTS = ["left", "center", "right"] as const;
const SWIPE = 40;
const RULER = [200, 190, 180, 170, 160, 150, 140, 130];
const BARCODE = [3, 1, 2, 4, 1, 2, 3, 1, 4, 2, 1, 3, 2, 1, 4, 2, 1, 3, 2, 4, 1, 3];

function archetypeKey(gender: FicheView["gender"]) {
  return gender === "woman" ? "badGirl" : gender === "man" ? "badBoy" : "bad";
}

/**
 * Where the subject of a cut-out stands in its image (normalised): the top of the head and the
 * horizontal centre, read from the transparency. Null for a photo kept as it is, or when the
 * image cannot be read (another origin without CORS): the photo is then framed from its top.
 */
function useSubject(photo: Photo | null): { top: number; cx: number } | null {
  const [box, setBox] = useState<{ url: string; top: number; cx: number } | null>(null);
  const url = photo?.cutout ? photo.url : null;
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const width = 48;
        const height = Math.max(1, Math.round((width * image.naturalHeight) / image.naturalWidth));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, width, height);
        const { data } = context.getImageData(0, 0, width, height);
        let top = height;
        let left = width;
        let right = -1;
        for (let y = 0; y < height; y += 1)
          for (let x = 0; x < width; x += 1) {
            if ((data[(y * width + x) * 4 + 3] ?? 0) < 40) continue;
            if (y < top) top = y;
            if (x < left) left = x;
            if (x > right) right = x;
          }
        if (alive && right >= 0)
          setBox({ url, top: top / height, cx: (left + right + 1) / 2 / width });
      } catch {
        // A tainted canvas: no framing, the photo stays as it is.
      }
    };
    image.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return box && box.url === url ? { top: box.top, cx: box.cx } : null;
}

/**
 * One photo in a frame. A cut-out fills the frame: anchored at the bottom, the head near the top,
 * centred on the subject. Decorative here (the frame carries the name of the pose).
 */
function PoseImage({ photo }: { photo: Photo | null }) {
  const subject = useSubject(photo);
  if (!photo)
    return (
      <UserRound
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 mx-auto h-[85%] w-full text-[#26262a]"
        strokeWidth={1.1}
      />
    );
  // The visible part starts a little above the head and goes to the bottom of the image.
  const from = subject ? Math.max(0, subject.top - 0.04) : 0;
  const style: CSSProperties = subject
    ? {
        height: `${100 / (1 - from)}%`,
        transform: `translateX(-${subject.cx * 100}%)`,
      }
    : {};
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-optimised WebP from the photos bucket
    <img
      src={photo.url}
      alt=""
      draggable={false}
      style={style}
      className={cn(
        "absolute max-w-none select-none",
        subject ? "bottom-0 left-1/2 w-auto" : "inset-0 size-full object-cover object-top",
      )}
    />
  );
}

/**
 * A Bad's Fiche, v7 (owner's decision 2026-10-24, docs/design/parcours/FicheShow.dc.html): the 3
 * poses on the common wall, the frames still and only the images changing (swipe, or a touch on
 * a side pose); a small placard under the chin of the middle pose, readable as it is, that grows
 * over the bottom of the screen (the heads stay visible); its back holds the charges and the bet.
 * The bet is kept on this page only and handed to the Demande de parloir: nothing of it is
 * recorded before the request is sent, and its result never shows before the visit (rule 14).
 * Never the birth date, a real name or a height (SPEC §5).
 */
export function FicheShow({
  fiche,
  photos,
  action,
  souffleur,
  back,
  safety,
  status,
  fullscreen = false,
}: {
  fiche: FicheView;
  photos: PhotoUrls;
  action: FicheAction;
  souffleur: PrompterInput | null;
  /** The link back (Promenade, Découverte, Ma Fiche). */
  back: ReactNode;
  /** Signaler and Bloquer (the existing flows), behind the flag. Null on one's own Fiche. */
  safety: ReactNode;
  /** The explanation shown instead of the button (cooldown, Permis waiting, own Fiche…). */
  status: string | null;
  /** Opened as a folder over the Découverte: no site header nor tab bar around it. */
  fullscreen?: boolean;
}) {
  const t = useTranslations("Relations.fiche");
  const locale = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const ids = useId();
  const accent = accentForGender(fiche.gender);
  const self = action.kind === "self";
  const betting = action.kind === "request" && souffleur !== null && fiche.charges.length === 3;

  const [base, setBase] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [bet, setBet] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const start = useRef<number | null>(null);
  const swiped = useRef(false);
  const smallPlacard = useRef<HTMLButtonElement>(null);
  const front = useRef<HTMLElement>(null);
  const backSide = useRef<HTMLElement>(null);

  const poses = POSES.map((pose) => ({
    ...pose,
    photo: photos[pose.position] ?? null,
    name: t(`pose_${pose.key}`),
  }));
  const shown = (slot: number) => poses[(base + slot) % 3]!;
  const shift = (step: number) => setBase((current) => (current + step + 3) % 3);

  function close() {
    setZoomed(false);
    requestAnimationFrame(() => smallPlacard.current?.focus());
  }

  function turn(next: boolean) {
    setFlipped(next);
    requestAnimationFrame(() => (next ? backSide : front).current?.focus());
  }

  useEffect(() => {
    if (!zoomed && !menu) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // A dialog of Signaler / Bloquer or of the Demande closes itself first; the folder that
      // holds the Fiche (DossierOverlay) waits: the placard and the menu close before it.
      const dialogs = [...document.querySelectorAll("dialog[open]")];
      if (dialogs.some((dialog) => !dialog.contains(root.current))) return;
      event.preventDefault();
      if (menu) setMenu(false);
      else close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoomed, menu]);

  const place = [
    fiche.city,
    fiche.distance_km !== null ? t("km", { km: fiche.distance_km }) : null,
  ].filter(Boolean);
  const line = [fiche.age !== null ? t("years", { age: fiche.age }) : null, ...place]
    .filter(Boolean)
    .join(" · ");
  const signs = fiche.tribes.map((tribe) => tribeText(tribe, locale));
  const seeking = fiche.seeking_genders.map((gender) => t(`seeking_${gender}`)).join(", ");
  const common = fiche.common_points.map((point) => localize(point.answer, locale));
  const ecrou = fiche.ecrou ?? "—";

  const vars = {
    "--pw": "min(300px, 77vw)",
    "--ph": "calc(var(--pw) * 1.3)",
    "--wh": fullscreen
      ? "max(calc(var(--ph) + 190px), calc(100dvh - 210px))"
      : "max(calc(var(--ph) + 190px), calc(100dvh - 330px))",
    "--mid": "calc(50% - 13px)",
  } as CSSProperties;

  return (
    <div ref={root} data-accent={accent} className="flex flex-col" data-testid="fiche">
      <div className="flex h-13 items-center justify-between gap-2 px-3">
        {back}
        <div className="flex items-center gap-1">
          {self ? null : (
            <p className="flex items-baseline gap-1.5">
              <span className="font-stamp text-[11px] tracking-[0.15em] text-[#b8ae9c]">
                {t("complicity")}
              </span>
              <span className="font-display text-[22px] text-[var(--color-accent)]">
                {fiche.complicity !== null
                  ? t("percent", { score: fiche.complicity })
                  : t("toEstablish")}
              </span>
            </p>
          )}
          {safety ? (
            <div className="relative">
              <button
                type="button"
                aria-label={t("flag")}
                aria-expanded={menu}
                aria-controls={`${ids}-menu`}
                onClick={() => setMenu((open) => !open)}
                className="focus-visible:outline-accent inline-flex size-11 items-center justify-center rounded-full text-[#b8ae9c] hover:text-[#f2e8d5] focus-visible:outline-3"
              >
                <Flag aria-hidden="true" className="size-5" />
              </button>
              <div
                id={`${ids}-menu`}
                hidden={!menu}
                className="border-line bg-ink absolute top-12 right-0 z-40 rounded-md border px-3 py-1.5 shadow-lg"
              >
                {safety}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative" style={vars}>
        <section
          aria-label={t("lineup", { pseudo: fiche.pseudo })}
          onPointerDown={(event) => {
            start.current = event.clientX;
            // A new touch: the click that may follow a swipe was the only one to ignore.
            swiped.current = false;
          }}
          onPointerCancel={() => {
            start.current = null;
          }}
          onPointerUp={(event) => {
            if (start.current === null) return;
            const dx = event.clientX - start.current;
            start.current = null;
            if (Math.abs(dx) < SWIPE) return;
            swiped.current = true;
            shift(dx < 0 ? 1 : -1);
          }}
          className="mugshot-wall relative h-[var(--wh)] touch-pan-y overflow-hidden select-none"
          data-testid="fiche-wall"
          data-base={base}
        >
          {/* The file's header, pinned on the wall. */}
          <div className="fiche-paper absolute top-3 right-9 left-2.5 z-[6] -rotate-1 py-1.5 pr-2.5 pl-9 shadow-[0_4px_10px_rgb(0_0_0/0.45)]">
            <span
              aria-hidden="true"
              className="fiche-sprite -top-[18px] -left-2.5 h-[65px] w-[52px] -rotate-[8deg] bg-[length:295px_148px] bg-[position:-23px_-15px]"
            />
            <span
              aria-hidden="true"
              className="fiche-sprite -top-2.5 -right-3.5 h-[35px] w-[89px] rotate-[14deg] bg-[length:260px_130px] bg-[position:-86px_-18px] opacity-90"
            />
            <h1 className="font-display text-[26px] leading-none tracking-[0.02em] uppercase">
              {t("caseFile")}
              <span className="sr-only"> · {fiche.pseudo}</span>
            </h1>
            <p className="font-stamp mt-0.5 text-[11px] tracking-[0.06em] text-[var(--color-accent-paper)] uppercase">
              {t("lineupTitle")}
            </p>
          </div>

          {/* The height chart, in code. */}
          <div
            aria-hidden="true"
            className="font-display absolute inset-y-0 right-0 z-[6] flex w-[26px] flex-col justify-around bg-[#0e0e10]/90 text-center text-[10px] text-[#efe6d2]"
          >
            {RULER.map((mark) => (
              <span
                key={mark}
                className={mark === 170 ? "text-ink bg-[var(--color-accent)]" : undefined}
              >
                {mark}
              </span>
            ))}
          </div>

          {SLOTS.map((slot, index) => {
            const current = shown(index);
            const layers = poses.map((pose) => (
              <div
                key={pose.key}
                aria-hidden="true"
                className="fiche-layer absolute inset-0 overflow-hidden"
                style={{
                  opacity: pose.key === current.key ? 1 : 0,
                  filter: pose.key === current.key ? "none" : "blur(8px)",
                }}
              >
                <PoseImage photo={pose.photo} />
              </div>
            ));
            const position: CSSProperties = {
              left:
                slot === "center"
                  ? "calc(var(--mid) - var(--pw) / 2)"
                  : slot === "left"
                    ? "calc(var(--mid) - var(--pw) / 2 - var(--pw) * 0.44)"
                    : "calc(var(--mid) - var(--pw) / 2 + var(--pw) * 0.44)",
            };
            const frame = "absolute bottom-0 h-[var(--ph)] w-[var(--pw)]";
            if (slot === "center")
              return (
                <div
                  key={slot}
                  role="img"
                  aria-label={t("centerPose", { pseudo: fiche.pseudo, pose: current.name })}
                  // No action of its own: a touch goes through its empty parts to the side poses.
                  className={cn(frame, "pointer-events-none z-[4]")}
                  style={position}
                  data-testid="pose-center"
                  data-pose={current.key}
                >
                  {layers}
                </div>
              );
            return (
              <button
                key={slot}
                type="button"
                aria-label={t("toCenter", { pose: current.name })}
                onClick={() => {
                  if (swiped.current) {
                    swiped.current = false;
                    return;
                  }
                  shift(slot === "left" ? -1 : 1);
                }}
                className={cn(
                  frame,
                  "pointer-events-none z-[2] brightness-[0.82] focus-visible:outline-3 focus-visible:-outline-offset-4 focus-visible:outline-[#e8b84a]",
                )}
                style={position}
                data-testid={`pose-${slot}`}
                data-pose={current.key}
              >
                {layers}
                {/* Touchable outside the middle person only: the outer 69 % of the frame. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-auto absolute inset-y-0 w-[69%] cursor-pointer",
                    slot === "left" ? "left-0" : "right-0",
                  )}
                />
              </button>
            );
          })}

          {fiche.good_conduct ? (
            <p className="fiche-stamp font-display absolute top-[92px] right-[30px] z-[7] rotate-[9deg] px-3.5 py-2 text-[13px] leading-none text-[#b5172e]">
              <span className="block rounded-sm bg-[#f2e8d5]/85 px-1 py-0.5">
                {t("goodConduct1")}
                <br />
                {t("goodConduct2")}
              </span>
            </p>
          ) : null}

          {zoomed ? null : (
            <button
              ref={smallPlacard}
              type="button"
              aria-expanded={false}
              aria-controls={`${ids}-zoom`}
              onClick={() => {
                setFlipped(false);
                setZoomed(true);
                requestAnimationFrame(() => front.current?.focus());
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              className="fiche-felt fiche-frame placard-letters focus-visible:outline-accent absolute z-[8] w-[calc(var(--pw)*0.847)] cursor-pointer border-[36px_24px_25px_24px] px-2 pt-1 pb-0.5 text-left drop-shadow-[0_8px_10px_rgb(0_0_0/0.45)] focus-visible:outline-3"
              style={{
                left: "calc(var(--mid) - var(--pw) * 0.4235)",
                top: "calc(var(--wh) - var(--ph) * 0.54)",
              }}
              data-testid="placard-small"
            >
              <span className="sr-only">{t("placardOf", { pseudo: fiche.pseudo })} </span>
              <span className="block text-[20px] leading-none tracking-[0.1em] break-words text-[var(--color-accent-board)]">
                {fiche.pseudo}
              </span>
              <span className="mt-1 block text-[12px] tracking-[0.06em]">{line}</span>
              {signs.length ? (
                <span className="mt-0.5 block truncate text-[11px] tracking-[0.04em] text-[#dcd6ca]">
                  {fiche.tribes.map((tribe) => localize(tribe.label, locale)).join(" · ")}
                </span>
              ) : null}
              <span className="mt-1 flex justify-between text-[10px] text-[#c9c3b8]">
                <span>{t("ecrou", { ecrou })}</span>
                <span>{t("enlarge")} ⤢</span>
              </span>
            </button>
          )}
        </section>

        {/* The paper at the foot of the file, with the bet and the request. */}
        <footer className="fiche-paper relative flex flex-col gap-2 border-t-4 border-[#0e0e10] px-3.5 pt-2.5 pb-3">
          <span
            aria-hidden="true"
            className="fiche-sprite top-0.5 right-1.5 h-[86px] w-[104px] bg-[length:414px_207px] bg-[position:-293px_-103px] opacity-45"
          />
          <div className="flex items-center gap-2.5">
            <svg width="96" height="30" viewBox="0 0 96 30" aria-hidden="true" className="shrink-0">
              <g fill="#0E0E10">
                {
                  BARCODE.reduce<{ x: number; bars: ReactNode[] }>(
                    (acc, width, index) => {
                      acc.bars.push(<rect key={index} x={acc.x} width={width} height="30" />);
                      acc.x += width + (index % 2 ? 2 : 1) + 1;
                      return acc;
                    },
                    { x: 0, bars: [] },
                  ).bars
                }
              </g>
            </svg>
            <p className="font-stamp relative flex-1 text-[12px] leading-snug tracking-[0.06em] uppercase">
              {t("footer", { ecrou, city: fiche.city ?? "—" })}
            </p>
          </div>
          <FicheFoot
            fiche={fiche}
            action={action}
            souffleur={souffleur}
            bet={bet}
            onBet={setBet}
            status={status}
          />
        </footer>

        {zoomed ? (
          <div
            id={`${ids}-zoom`}
            role="region"
            aria-label={t("zoomLabel", { pseudo: fiche.pseudo })}
            className="fiche-zoom absolute inset-x-0 bottom-2 z-20 mx-auto w-[min(354px,calc(100%-36px))] [perspective:1300px]"
            style={{ top: "calc(var(--wh) - var(--ph) * 0.68)" }}
            data-testid="placard-zoom"
          >
            <div className="fiche-card relative size-full" data-flipped={flipped ? "" : undefined}>
              <section
                ref={front}
                tabIndex={-1}
                aria-label={t("front")}
                inert={flipped}
                aria-hidden={flipped || undefined}
                style={{ pointerEvents: flipped ? "none" : "auto" }}
                className="fiche-side fiche-felt fiche-frame placard-letters absolute inset-0 flex flex-col gap-1.5 overflow-y-auto border-[40px_25px_27px_25px] px-2.5 py-2 drop-shadow-[0_16px_22px_rgb(0_0_0/0.6)] focus:outline-none"
              >
                <ReduceButton label={t("reduce")} onClick={close} light />
                <p className="pr-11 text-[32px] leading-none tracking-[0.1em] break-words text-[var(--color-accent-board)]">
                  {fiche.pseudo}
                </p>
                <p className="text-[13px] tracking-[0.06em]">
                  {[t(archetypeKey(fiche.gender)), line].filter(Boolean).join(" · ")}
                </p>
                <div aria-hidden="true" className="my-0.5 h-px bg-[#3a3a40]" />
                <ZoomRow title={t("signsTitle")}>
                  {signs.length
                    ? signs.map((sign) => (
                        <span key={sign} className="block">
                          {sign}
                        </span>
                      ))
                    : t("noSigns")}
                </ZoomRow>
                <ZoomRow title={t("seekingTitle")}>
                  {t("seeking", {
                    genders: seeking,
                    min: fiche.seek_age_min,
                    max: fiche.seek_age_max,
                  })}
                </ZoomRow>
                {self ? null : (
                  <ZoomRow title={t("commonTitle")}>
                    {common.length ? common.join(" · ") : t("noCommon")}
                  </ZoomRow>
                )}
                <ZoomRow title={t("noteTitle")}>
                  <span className="font-sans text-[12px] leading-relaxed font-semibold tracking-normal normal-case [text-shadow:none]">
                    {fiche.bio ? `« ${fiche.bio} »` : t("noBio")}
                  </span>
                </ZoomRow>
                <p className="text-[11px] tracking-[0.08em]">
                  <span className={fiche.requests_open ? "text-[#8ee2b0]" : "text-[#dcd6ca]"}>
                    {fiche.requests_open ? t("open") : t("full")}
                  </span>
                  {fiche.recruited > 0 ? (
                    <span className="text-[#c9c3b8]">
                      {" "}
                      · {t("recruited", { count: fiche.recruited })}
                    </span>
                  ) : null}
                </p>
                <button
                  type="button"
                  onClick={() => turn(true)}
                  className="text-ink focus-visible:outline-accent sticky bottom-0 mt-auto inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-board)] px-4 font-sans text-[15px] font-extrabold tracking-normal normal-case shadow-[0_-6px_12px_rgb(28_28_31/0.9)] [text-shadow:none] focus-visible:outline-3 focus-visible:outline-offset-2"
                >
                  {t("flipToCharges")}
                </button>
              </section>

              <section
                ref={backSide}
                tabIndex={-1}
                aria-labelledby={`${ids}-charges`}
                inert={!flipped}
                aria-hidden={!flipped || undefined}
                style={{ pointerEvents: flipped ? "auto" : "none" }}
                className="fiche-side fiche-back fiche-paper absolute inset-0 flex flex-col gap-2 overflow-y-auto rounded-md border-[3px] border-[#0e0e10] p-3.5 shadow-[0_22px_44px_rgb(0_0_0/0.65)] focus:outline-none"
              >
                <ReduceButton label={t("reduce")} onClick={close} />
                {betting ? (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mr-11 pb-1">
                      <span id={`${ids}-charges`}>
                        <span className="font-display text-[22px] uppercase">{t("charges")}</span>
                        <span className="sr-only"> · </span>{" "}
                        <span className="font-stamp text-[11px] uppercase">{t("oneTrue")}</span>
                      </span>
                    </legend>
                    <p className="border-t-[3px] border-[var(--color-accent-paper)] pt-1.5 text-[13px] font-semibold">
                      {t("betHint")}
                    </p>
                    {fiche.charges.map((charge, index) => {
                      const value = index + 1;
                      const checked = pick === value;
                      return (
                        <label
                          key={charge}
                          className={cn(
                            "has-focus-visible:outline-ink flex min-h-11 cursor-pointer items-start gap-2.5 border-2 border-[#0e0e10] bg-white px-2.5 py-2 has-focus-visible:outline-3 has-focus-visible:outline-offset-2",
                            checked && "shadow-[4px_4px_0_var(--color-accent-paper)]",
                          )}
                        >
                          <input
                            type="radio"
                            name={`${ids}-pari`}
                            value={value}
                            checked={checked}
                            onChange={() => setPick(value)}
                            className="mt-0.5 size-[22px] shrink-0 accent-[var(--color-accent-paper)]"
                          />
                          <span className="font-stamp text-[15px] leading-snug">
                            <span className="sr-only">{t("chargeNumber", { number: value })} </span>
                            <span aria-hidden="true" className="text-[var(--color-accent-paper)]">
                              {value}.{" "}
                            </span>
                            {charge}
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                ) : (
                  <>
                    <h2 id={`${ids}-charges`} className="mr-11">
                      <span className="font-display text-[22px] uppercase">{t("charges")}</span>
                      <span className="sr-only"> · </span>{" "}
                      <span className="font-stamp text-[11px] uppercase">{t("oneTrue")}</span>
                    </h2>
                    <ol className="flex flex-col gap-2">
                      {fiche.charges.map((charge, index) => (
                        <li
                          key={charge}
                          className="font-stamp border-2 border-[#0e0e10] bg-white px-2.5 py-2 text-[15px] leading-snug"
                        >
                          <span aria-hidden="true" className="text-[var(--color-accent-paper)]">
                            {index + 1}.{" "}
                          </span>
                          {charge}
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                {fiche.casier_changed_since_request ? (
                  <p className="text-[13px] font-semibold">{t("casierChanged")}</p>
                ) : null}
                <div className="fiche-paper sticky -bottom-3.5 -mx-3.5 mt-auto -mb-3.5 flex shrink-0 gap-2 px-3.5 pt-2 pb-3.5">
                  <button
                    type="button"
                    onClick={() => turn(false)}
                    className="text-ink focus-visible:outline-ink min-h-12 rounded border-2 border-[#0e0e10] px-3.5 text-[14px] font-bold focus-visible:outline-3 focus-visible:outline-offset-2"
                  >
                    {t("recto")}
                  </button>
                  {betting ? (
                    <button
                      type="button"
                      disabled={pick === null}
                      onClick={() => {
                        if (pick === null) return;
                        setBet(pick);
                        setZoomed(false);
                        requestAnimationFrame(() => document.getElementById("fiche-ask")?.focus());
                      }}
                      className="font-display text-ink focus-visible:outline-ink min-h-12 flex-1 rounded bg-[#d4a437] text-[17px] uppercase focus-visible:outline-3 focus-visible:outline-offset-2 disabled:bg-[#b8ae9c] disabled:text-[#3a342c]"
                    >
                      {t("validate")}
                    </button>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReduceButton({
  label,
  onClick,
  light = false,
}: {
  label: string;
  onClick: () => void;
  light?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "absolute top-1 right-1 z-[2] inline-flex size-11 items-center justify-center rounded-full focus-visible:outline-3 focus-visible:-outline-offset-2",
        light
          ? "focus-visible:outline-accent text-[#f4f1ea]"
          : "focus-visible:outline-ink text-ink",
      )}
    >
      <Minimize2 aria-hidden="true" className="size-5" strokeWidth={2.4} />
    </button>
  );
}

function ZoomRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-[#c9c3b8]">{title}</p>
      <p className="text-[13px] leading-snug tracking-[0.06em]">{children}</p>
    </div>
  );
}

/** The bottom of the file: the bet and the request, or why there is none. */
function FicheFoot({
  fiche,
  action,
  souffleur,
  bet,
  onBet,
  status,
}: {
  fiche: FicheView;
  action: FicheAction;
  souffleur: PrompterInput | null;
  bet: number | null;
  onBet: (value: number) => void;
  status: string | null;
}) {
  const t = useTranslations("Relations.fiche");
  const gold =
    "font-display text-ink flex min-h-[54px] w-full items-center justify-center border-[3px] border-[#0e0e10] bg-[#d4a437] px-3 text-[20px] uppercase focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#0e0e10] disabled:bg-[#b8ae9c] disabled:text-[#3a342c]";
  let main: ReactNode = null;
  if (action.kind === "request" && souffleur && fiche.charges.length === 3) {
    main =
      bet !== null ? (
        <RequestModal
          badId={fiche.id}
          accent={accentForGender(fiche.gender)}
          pseudo={fiche.pseudo}
          charges={fiche.charges}
          souffleur={souffleur}
          guess={bet}
          onGuess={onBet}
          triggerId="fiche-ask"
          triggerClassName={gold}
        />
      ) : (
        <p className="font-stamp flex min-h-[54px] items-center justify-center border-2 border-dashed border-[#6a6256] px-3 text-center text-[13px] text-[#3a342c]">
          {t("betFirst")}
        </p>
      );
  } else if (action.kind === "sent") {
    main = (
      <button type="button" disabled className={gold}>
        {t("sent")}
      </button>
    );
  } else if (action.kind === "full") {
    main = (
      <>
        <button type="button" disabled aria-describedby="fiche-full-hint" className={gold}>
          {t("fullButton")}
        </button>
        <p id="fiche-full-hint" className="text-center text-xs text-[#3a342c]">
          {t("fullHint")}
        </p>
      </>
    );
  }
  return (
    <div
      className="relative flex flex-col gap-1.5"
      data-testid="fiche-action"
      data-action={action.kind}
    >
      {main}
      {status ? (
        <p
          role="status"
          className="border-2 border-[#0e0e10] px-3 py-2.5 text-center text-sm font-semibold"
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
