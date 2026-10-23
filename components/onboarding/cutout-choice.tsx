"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Mugshot } from "@/components/brand/mugshot";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { CutoutResult } from "@/lib/image/cutout";

/** What is sent: the cut-out, or the original that the Greffe will cut out (`cutout` false). */
export type PhotoChoice = { blob: Blob; cutout: boolean };

const RELOADED_KEY = "cutout-reloaded";

/** Loads the page again, once per page, to get the photo page's own policy. */
function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_KEY) === location.pathname) return false;
    sessionStorage.setItem(RELOADED_KEY, location.pathname);
  } catch {
    return false;
  }
  location.reload();
  return true;
}

/**
 * Starts loading the cut-out runtime as soon as a photo page is shown (shared afterwards), and
 * returns where the cut-out will run ("loading" until known; data-cutout-engine for the tests).
 * Where it cannot run at all (a photo page reached by a link, in a browser whose worker cannot
 * compute), the page is loaded again once, right away, to get its own policy.
 */
export function usePreloadCutout(): string {
  const [engine, setEngine] = useState("loading");
  useEffect(() => {
    let alive = true;
    void import("@/lib/image/cutout")
      .then(async (module) => {
        const where = await module.chooseEngine();
        if (where === "none" && reloadOnce()) return;
        if (alive) setEngine(where);
        await module.preloadCutout();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return engine;
}

/** Runs the cut-out of `photo` on the device; any failure is a decision, never an exception. */
function useCutout(photo: Blob): CutoutResult | null {
  const [result, setResult] = useState<CutoutResult | null>(null);
  useEffect(() => {
    let alive = true;
    void import("@/lib/image/cutout")
      .then((module) => module.cutOut(photo))
      .catch(() => null)
      .then((outcome) => {
        if (!alive) return;
        setResult(
          outcome ?? { decision: { kind: "as_is", reason: "error" }, blob: null, elapsedMs: 0 },
        );
      });
    return () => {
      alive = false;
    };
  }, [photo]);
  return result;
}

/** An object URL for `blob`, revoked when the blob changes or the component goes away. */
export function useObjectUrl(blob: Blob | null): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

/**
 * The preview before « Déposer au Greffe » (owner's final decision 2026-10-23): the same wall for
 * everyone, no choice. The photo is cut out here, on the device, and shown on the wall; when the
 * device cannot, the original is sent and the Greffe cuts it out before validating it. Nothing is
 * sent until the member confirms; « Changer de photo » picks another file.
 */
function CutoutDialog({
  photo,
  onDone,
  onReplace,
}: {
  photo: Blob;
  onDone: (choice: PhotoChoice | null) => void;
  onReplace: (file: File) => void;
}) {
  const t = useTranslations("Onboarding.cutout");
  const inputId = useId();
  const result = useCutout(photo);
  const original = useObjectUrl(photo);
  const cutoutUrl = useObjectUrl(result?.blob ?? null);
  const ready = result !== null;
  const cut = result?.decision.kind === "cutout" && result.blob ? result.blob : null;

  const change = (
    <label
      htmlFor={inputId}
      className="border-line has-focus-visible:outline-accent flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg border px-4 font-semibold has-focus-visible:outline-3"
    >
      {t("change")}
      <input
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = "";
          if (chosen) onReplace(chosen);
        }}
      />
    </label>
  );

  return (
    <Modal open onClose={() => onDone(null)} title={t("title")}>
      <div
        className="space-y-4"
        data-testid="cutout-result"
        data-decision={result?.decision.kind ?? "working"}
        data-reason={result?.decision.kind === "as_is" ? result.decision.reason : undefined}
        data-ms={result?.elapsedMs}
        data-detail={result?.detail}
      >
        <p className="text-grey text-sm">{t("local")}</p>
        {!ready ? (
          <>
            {original ? (
              <Mugshot
                src={original}
                alt={t("originalAlt")}
                cutout={false}
                className="mx-auto aspect-[3/4] w-40 rounded-sm opacity-60"
              />
            ) : null}
            <p role="status" className="text-center font-semibold">
              {t("working")}
            </p>
            {change}
          </>
        ) : (
          <>
            {cut && cutoutUrl ? (
              <Mugshot
                src={cutoutUrl}
                alt={t("cutoutAlt")}
                cutout
                className="mx-auto aspect-[3/4] w-48 rounded-sm"
              />
            ) : (
              <>
                <p role="status" className="font-semibold">
                  {t(
                    `fallback_${result.decision.kind === "as_is" ? result.decision.reason : "error"}`,
                  )}
                </p>
                {original ? (
                  <Mugshot
                    src={original}
                    alt={t("originalAlt")}
                    cutout={false}
                    className="mx-auto aspect-[3/4] w-40 rounded-sm"
                  />
                ) : null}
              </>
            )}
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className="w-full"
                onClick={() =>
                  onDone(cut ? { blob: cut, cutout: true } : { blob: photo, cutout: false })
                }
              >
                {t("send")}
              </Button>
              {change}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * `choose(photo)` opens the preview and resolves with what to send (null: cancelled). A file
 * picked with « Changer de photo » is prepared by `prepare` (the same compression as the first
 * one) and previewed in turn; if it cannot be read, the promise is rejected.
 */
export function useCutoutChoice(prepare: (file: File) => Promise<Blob>): {
  choose: (photo: Blob) => Promise<PhotoChoice | null>;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<{
    photo: Blob;
    key: number;
    resolve: (choice: PhotoChoice | null) => void;
    reject: (error: unknown) => void;
  } | null>(null);
  const counter = useRef(0);
  const choose = useCallback(
    (photo: Blob) =>
      new Promise<PhotoChoice | null>((resolve, reject) => {
        counter.current += 1;
        setRequest({ photo, key: counter.current, resolve, reject });
      }),
    [],
  );
  const dialog = request ? (
    <CutoutDialog
      key={request.key}
      photo={request.photo}
      onDone={(choice) => {
        request.resolve(choice);
        setRequest(null);
      }}
      onReplace={(file) => {
        prepare(file).then(
          (photo) => {
            counter.current += 1;
            setRequest({ ...request, photo, key: counter.current });
          },
          (error: unknown) => {
            request.reject(error);
            setRequest(null);
          },
        );
      }}
    />
  ) : null;
  return { choose, dialog };
}

/** The compression used before every upload (lib/image/compress), loaded on demand. */
export async function prepareForUpload(file: File): Promise<Blob> {
  const { compressForUpload } = await import("@/lib/image/compress");
  return compressForUpload(file);
}
