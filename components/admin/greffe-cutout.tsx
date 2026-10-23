"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  replaceWithCutoutAction,
  storeGreffeCutoutAction,
  type CutoutState,
} from "@/app/[locale]/(app)/admin/greffe/actions";
import { Mugshot } from "@/components/brand/mugshot";
import { useObjectUrl, usePreloadCutout } from "@/components/onboarding/cutout-choice";
import { Button } from "@/components/ui/button";

/**
 * Cuts out the photo at `src` in the admin's browser (the same tool as the members'). Returns the
 * cut-out, or why there is none.
 */
async function cutOutUrl(src: string): Promise<{ blob: Blob | null; reason: string | null }> {
  const response = await fetch(src).catch(() => null);
  if (!response?.ok) return { blob: null, reason: "download" };
  const { cutOut } = await import("@/lib/image/cutout");
  const result = await cutOut(await response.blob());
  return result.decision.kind === "cutout" && result.blob
    ? { blob: result.blob, reason: null }
    : {
        blob: null,
        reason: `${result.decision.kind === "as_is" ? result.decision.reason : "error"} ${result.detail ?? ""}`,
      };
}

function send(
  action: (form: FormData) => Promise<CutoutState>,
  photoId: string,
  blob: Blob,
): Promise<CutoutState> {
  const form = new FormData();
  form.set("photoId", photoId);
  form.set("photo", blob, "photo");
  return action(form);
}

type Step = "idle" | "working" | "ready" | "failed" | "saving" | "error";

/**
 * Le Greffe, a pose the member's device could not cut out (owner's final decision 2026-10-23):
 * the admin cuts it out here, checks the result on the wall, then records it. Only then can the
 * photo be validated (the base refuses it otherwise). If it cannot be cut out, it is refused
 * with a motive, as any other photo.
 */
export function GreffeCutout({ photoId, src, alt }: { photoId: string; src: string; alt: string }) {
  const t = useTranslations("Greffe.cutoutTool");
  const router = useRouter();
  const engine = usePreloadCutout();
  const [step, setStep] = useState<Step>("idle");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const url = useObjectUrl(blob);

  async function run() {
    setStep("working");
    const result = await cutOutUrl(src).catch(() => ({ blob: null, reason: "error" }));
    setBlob(result.blob);
    setReason(result.reason);
    setStep(result.blob ? "ready" : "failed");
  }

  async function save() {
    if (!blob) return;
    setStep("saving");
    const result = await send(storeGreffeCutoutAction, photoId, blob).catch(() => null);
    if (result?.status === "done") router.refresh();
    else setStep("error");
  }

  return (
    <div
      className="space-y-2"
      data-testid="greffe-cutout"
      data-cutout-engine={engine}
      data-step={step}
      data-reason={reason ?? undefined}
    >
      {step === "ready" || step === "saving" || step === "error" ? (
        url ? (
          <Mugshot
            src={url}
            alt={t("previewAlt", { alt })}
            cutout
            className="aspect-[3/4] rounded-sm"
          />
        ) : null
      ) : null}
      <p role="status" aria-live="polite" className="text-sm">
        {step === "working"
          ? t("working")
          : step === "failed"
            ? t("failed")
            : step === "error"
              ? t("error")
              : null}
      </p>
      {step === "ready" || step === "error" ? (
        <div className="flex flex-col gap-2">
          <Button type="button" className="w-full" onClick={() => void save()}>
            {t("save")}
          </Button>
          <Button type="button" variant="secondary" className="w-full" onClick={() => void run()}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          className="w-full"
          disabled={step === "working" || step === "saving"}
          aria-busy={step === "working" || step === "saving"}
          onClick={() => void run()}
        >
          {step === "failed" ? t("retry") : t("run")}
        </Button>
      )}
    </div>
  );
}

type Item = { photoId: string; src: string; alt: string };
type ItemState =
  | { step: "waiting" | "working" | "failed" | "saving" | "done" | "kept" | "error" }
  | { step: "ready"; blob: Blob };

function BatchRow({
  item,
  state,
  onValidate,
  onKeep,
}: {
  item: Item;
  state: ItemState;
  onValidate: () => void;
  onKeep: () => void;
}) {
  const t = useTranslations("Greffe.batch");
  const url = useObjectUrl(state.step === "ready" ? state.blob : null);
  return (
    <li
      className="border-line space-y-3 rounded-lg border bg-[#121214] p-3"
      data-testid="batch-item"
      data-step={state.step}
    >
      <p className="font-semibold">{item.alt}</p>
      <div className="grid grid-cols-2 gap-2">
        <figure className="space-y-1">
          <Mugshot
            src={item.src}
            alt={t("beforeAlt", { alt: item.alt })}
            cutout={false}
            className="aspect-[3/4] rounded-sm"
          />
          <figcaption className="text-center text-xs">{t("before")}</figcaption>
        </figure>
        <figure className="space-y-1">
          {url ? (
            <Mugshot
              src={url}
              alt={t("afterAlt", { alt: item.alt })}
              cutout
              className="aspect-[3/4] rounded-sm"
            />
          ) : (
            <div className="mugshot-wall aspect-[3/4] rounded-sm" />
          )}
          <figcaption className="text-center text-xs">{t("after")}</figcaption>
        </figure>
      </div>
      <p role="status" className="text-sm">
        {state.step === "ready" ? null : t(`states.${state.step}`)}
      </p>
      {state.step === "ready" ? (
        <div className="flex flex-col gap-2">
          <Button type="button" className="w-full" onClick={onValidate}>
            {t("validate")}
          </Button>
          <Button type="button" variant="secondary" className="w-full" onClick={onKeep}>
            {t("keep")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Preview only: the photos validated before the owner's final decision (2026-10-23), cut out one
 * by one in the admin's browser, each shown before and after. « Valider » replaces the photo by
 * its cut-out, « Garder l'ancienne » leaves it as it is, « Tout valider » validates every ready
 * one.
 */
export function PhotoBatch({ items }: { items: Item[] }) {
  const t = useTranslations("Greffe.batch");
  const engine = usePreloadCutout();
  const [states, setStates] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(items.map((item) => [item.photoId, { step: "waiting" }])),
  );
  const set = (id: string, state: ItemState) =>
    setStates((previous) => ({ ...previous, [id]: state }));

  // One cut-out at a time, in order; the first item still waiting is the one being cut out.
  useEffect(() => {
    if (engine === "loading") return;
    let alive = true;
    void (async () => {
      for (const item of items) {
        const { blob } = await cutOutUrl(item.src).catch(() => ({ blob: null }));
        if (!alive) return;
        setStates((previous) => ({
          ...previous,
          [item.photoId]: blob ? { step: "ready", blob } : { step: "failed" },
        }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [items, engine]);
  const working = items.find((item) => states[item.photoId]?.step === "waiting")?.photoId;

  async function validate(item: Item) {
    const state = states[item.photoId];
    if (state?.step !== "ready") return;
    set(item.photoId, { step: "saving" });
    const result = await send(replaceWithCutoutAction, item.photoId, state.blob).catch(() => null);
    set(item.photoId, { step: result?.status === "done" ? "done" : "error" });
  }

  async function validateAll() {
    for (const item of items) await validate(item);
  }

  const ready = items.filter((item) => states[item.photoId]?.step === "ready").length;
  return (
    <div className="space-y-4" data-cutout-engine={engine}>
      <Button type="button" disabled={ready === 0} onClick={() => void validateAll()}>
        {t("validateAll", { count: ready })}
      </Button>
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <BatchRow
            key={item.photoId}
            item={item}
            state={
              item.photoId === working
                ? { step: "working" }
                : (states[item.photoId] ?? { step: "waiting" })
            }
            onValidate={() => void validate(item)}
            onKeep={() => set(item.photoId, { step: "kept" })}
          />
        ))}
      </ul>
    </div>
  );
}
