"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Mugshot } from "@/components/brand/mugshot";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { CutoutResult } from "@/lib/image/cutout";

export type PhotoChoice = { blob: Blob; cutout: boolean };

/** Starts loading the cut-out runtime as soon as a photo step is shown (shared afterwards). */
export function usePreloadCutout() {
  useEffect(() => {
    void import("@/lib/image/cutout")
      .then((module) => module.preloadCutout())
      .catch(() => undefined);
  }, []);
}

/**
 * The preview before « Déposer au Greffe » (owner's decision 2026-10-23, version B): the photo cut
 * out on the wall of the site, or kept as it is with the graduations over it. The cut-out runs on
 * the device; nothing is sent until the member chooses.
 */
function CutoutDialog({
  photo,
  onDone,
}: {
  photo: Blob;
  onDone: (choice: PhotoChoice | null) => void;
}) {
  const t = useTranslations("Onboarding.cutout");
  const [original] = useState(() => URL.createObjectURL(photo));
  const [result, setResult] = useState<CutoutResult | null>(null);
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void import("@/lib/image/cutout")
      .then((module) => module.cutOut(photo))
      .catch(() => null)
      .then((outcome) => {
        if (!alive) return;
        const done: CutoutResult = outcome ?? {
          decision: { kind: "as_is", reason: "error" },
          blob: null,
          elapsedMs: 0,
        };
        setResult(done);
        if (done.blob) setCutoutUrl(URL.createObjectURL(done.blob));
      });
    return () => {
      alive = false;
    };
  }, [photo]);

  useEffect(() => () => URL.revokeObjectURL(original), [original]);
  useEffect(
    () => () => {
      if (cutoutUrl) URL.revokeObjectURL(cutoutUrl);
    },
    [cutoutUrl],
  );

  const ready = result !== null;
  const cut = result?.decision.kind === "cutout" && result.blob && cutoutUrl;

  return (
    <Modal open onClose={() => onDone(null)} title={t("title")}>
      <div
        className="space-y-4"
        data-testid="cutout-result"
        data-decision={result?.decision.kind ?? "working"}
        data-reason={result?.decision.kind === "as_is" ? result.decision.reason : undefined}
        data-ms={result?.elapsedMs}
      >
        <p className="text-grey text-sm">{t("local")}</p>
        {!ready ? (
          <div className="space-y-3">
            <Mugshot
              src={original}
              alt={t("asIsAlt")}
              cutout={false}
              className="mx-auto aspect-[3/4] w-40 rounded-sm opacity-60"
            />
            <p role="status" className="text-center font-semibold">
              {t("working")}
            </p>
            {/* The member may stop waiting at any time: the photo stays as it is. */}
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => onDone({ blob: photo, cutout: false })}
            >
              {t("keepAsIs")}
            </Button>
          </div>
        ) : cut ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <figure className="space-y-1.5">
                <Mugshot
                  src={cutoutUrl}
                  alt={t("cutoutAlt")}
                  cutout
                  className="aspect-[3/4] rounded-sm"
                />
                <figcaption className="text-center text-xs font-semibold">
                  {t("cutoutCaption")}
                </figcaption>
              </figure>
              <figure className="space-y-1.5">
                <Mugshot
                  src={original}
                  alt={t("asIsAlt")}
                  cutout={false}
                  className="aspect-[3/4] rounded-sm"
                />
                <figcaption className="text-center text-xs font-semibold">
                  {t("asIsCaption")}
                </figcaption>
              </figure>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className="w-full"
                onClick={() => result?.blob && onDone({ blob: result.blob, cutout: true })}
              >
                {t("useCutout")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => onDone({ blob: photo, cutout: false })}
              >
                {t("keepAsIs")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p role="status" className="font-semibold">
              {t(`fallback_${result.decision.kind === "as_is" ? result.decision.reason : "error"}`)}
            </p>
            <Mugshot
              src={original}
              alt={t("asIsAlt")}
              cutout={false}
              className="mx-auto aspect-[3/4] w-48 rounded-sm"
            />
            <Button
              type="button"
              className="w-full"
              onClick={() => onDone({ blob: photo, cutout: false })}
            >
              {t("useAsIs")}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

/** `choose(photo)` opens the preview and resolves with the member's choice (null: cancelled). */
export function useCutoutChoice(): {
  choose: (photo: Blob) => Promise<PhotoChoice | null>;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<{
    photo: Blob;
    resolve: (choice: PhotoChoice | null) => void;
  } | null>(null);
  const choose = useCallback(
    (photo: Blob) => new Promise<PhotoChoice | null>((resolve) => setRequest({ photo, resolve })),
    [],
  );
  const dialog = request ? (
    <CutoutDialog
      photo={request.photo}
      onDone={(choice) => {
        request.resolve(choice);
        setRequest(null);
      }}
    />
  ) : null;
  return { choose, dialog };
}
