"use client";

import { Camera, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useId, useState } from "react";
import {
  savePosesStep,
  uploadPhotoAction,
  type StepState,
} from "@/app/[locale]/(app)/onboarding/actions";
import { Mugshot } from "@/components/brand/mugshot";
import { FramingGuide } from "@/components/brand/placard";
import {
  prepareForUpload,
  useCutoutChoice,
  usePreloadCutout,
} from "@/components/onboarding/cutout-choice";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { PhotoInfo } from "@/lib/photos";

/** Display order of the maquette (Photos.dc.html): left profile, face, right profile. */
const SLOTS = [
  { position: 1, key: "left" },
  { position: 0, key: "face" },
  { position: 2, key: "right" },
] as const;

type Slot = (typeof SLOTS)[number];
const IDLE: StepState = { status: "idle" };

function PoseSlot({
  slot,
  initial,
  onUploaded,
}: {
  slot: Slot;
  initial: PhotoInfo | null;
  onUploaded: (position: number) => void;
}) {
  const t = useTranslations("Onboarding.poses");
  const cutoutT = useTranslations("Onboarding.cutout");
  const errorT = useTranslations("Onboarding.errors");
  const id = useId();
  const reasonT = useTranslations("Greffe.reasons");
  const [url, setUrl] = useState(initial?.url ?? null);
  const [cutout, setCutout] = useState(initial?.cutout ?? false);
  const [status, setStatus] = useState(initial?.status ?? null);
  const { choose, dialog } = useCutoutChoice(prepareForUpload, { placard: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const label = t(slot.key);
  const face = slot.key === "face";

  useEffect(
    () => () => {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    },
    [url],
  );

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    setBusy(true);
    try {
      // The preview on the wall, cut out on the device: nothing leaves before « Déposer au Greffe ».
      const choice = await choose(await prepareForUpload(file));
      if (!choice) return;
      const blob = choice.blob;
      const form = new FormData();
      form.set("photo", blob, "photo");
      form.set("position", String(slot.position));
      const result = await uploadPhotoAction(IDLE, form);
      if (result.status === "error") {
        const key = result.fields?.photo ?? result.message ?? "generic";
        setError(errorT(key as "generic"));
        return;
      }
      setUrl(URL.createObjectURL(blob));
      setCutout(choice.cutout);
      setStatus("pending");
      onUploaded(slot.position);
    } catch {
      setError(errorT("photoUnreadable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-col items-center gap-1.5", face ? "flex-[1.15]" : "flex-1")}>
      <label
        htmlFor={id}
        className={cn(
          "toise-wall has-focus-visible:outline-accent relative flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-sm border-2 has-focus-visible:outline-3",
          face ? "aspect-[3/4]" : "aspect-[3/4.4]",
          status === "rejected"
            ? "border-red-bright border-dashed"
            : url
              ? "border-green-bright"
              : "border-dashed border-[#5a5a60]",
        )}
      >
        {url ? (
          <Mugshot src={url} alt={t("previewAlt", { pose: label })} cutout={cutout} fill />
        ) : (
          <>
            <FramingGuide placard={cutoutT("placard")} />
            <span className="relative -mt-[25%] flex flex-col items-center gap-1 text-sm font-bold">
              <Camera aria-hidden="true" className="size-6" />
              {t("add")}
            </span>
          </>
        )}
        <input
          id={id}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label={`${url ? t("replace") : t("add")} : ${label}`}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={busy}
          onChange={(event) => {
            // Read, then cleared: the same file may be chosen again after a cancel.
            const chosen = event.target.files?.[0];
            event.target.value = "";
            void onFile(chosen);
          }}
        />
      </label>
      <span className="font-stamp text-center text-[11px] tracking-[0.1em] text-[#e6dcc8] uppercase">
        {label}
      </span>
      <span aria-live="polite" className="min-h-5 text-xs font-bold">
        {busy ? (
          <span className="text-grey">{t("uploading")}</span>
        ) : status === "approved" ? (
          <span className="text-green-bright inline-flex items-center gap-1">
            <Check aria-hidden="true" className="size-3.5" />
            {t("approved")}
          </span>
        ) : status === "rejected" ? (
          <span className="text-red-bright">
            {t("rejected", { reason: reasonT((initial?.reason ?? "other") as "other") })}
          </span>
        ) : url && !cutout ? (
          <span className="text-grey">{t("greffeCutout")}</span>
        ) : url ? (
          <span className="text-green-bright inline-flex items-center gap-1">
            <Check aria-hidden="true" className="size-3.5" />
            {t("added")}
          </span>
        ) : (
          <span className="text-grey">{t("todo")}</span>
        )}
      </span>
      {dialog}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-red-bright text-center text-xs font-medium"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PoseSlots({
  photos,
  onUploaded,
}: {
  photos: Record<number, PhotoInfo | null>;
  onUploaded: (position: number) => void;
}) {
  const engine = usePreloadCutout();
  const t = useTranslations("Onboarding.cutout");
  return (
    <div className="space-y-2" data-cutout-engine={engine}>
      <p className="font-stamp text-center text-sm text-[#e6dcc8]">{t("framing")}</p>
      <div className="flex items-end gap-2.5">
        {SLOTS.map((slot) => (
          <PoseSlot
            key={slot.position}
            slot={slot}
            initial={photos[slot.position] ?? null}
            onUploaded={onUploaded}
          />
        ))}
      </div>
    </div>
  );
}

function GreffeRules() {
  const t = useTranslations("Onboarding.poses");
  return (
    <section
      aria-labelledby="greffe-rules"
      className="border-line space-y-2 rounded-lg border bg-[#121214] p-4"
    >
      <h2 id="greffe-rules" className="text-accent text-lg uppercase">
        {t("rulesTitle")}
      </h2>
      <ul className="list-inside list-disc space-y-1 text-sm">
        {(t.raw("rules") as string[]).map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </section>
  );
}

/** Ma Fiche: the same 3 poses, each one replaceable (a new file goes back to the Greffe). */
export function PosesEditor({ photos }: { photos: Record<number, PhotoInfo | null> }) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <PoseSlots photos={photos} onUploaded={() => router.refresh()} />
      <GreffeRules />
    </div>
  );
}

/** Bad, step 5 « Passe à la toise »: the 3 poses, each uploaded as soon as it is chosen. */
export function PosesStepForm({ photos }: { photos: Record<number, PhotoInfo | null> }) {
  const t = useTranslations("Onboarding.poses");
  const errorT = useTranslations("Onboarding.errors");
  const [state, formAction, pending] = useActionState(savePosesStep, IDLE);
  const [done, setDone] = useState<Set<number>>(
    () =>
      new Set(
        Object.entries(photos).flatMap(([position, photo]) =>
          photo && photo.status !== "rejected" ? [Number(position)] : [],
        ),
      ),
  );
  const fieldError = state.status === "error" ? state.fields?.photo : undefined;
  const message =
    state.status === "error"
      ? errorT((fieldError ?? state.message ?? "generic") as "generic")
      : undefined;

  return (
    <form action={formAction} className="space-y-6">
      <p className="text-cream/85 text-center">{t("lead")}</p>
      <PoseSlots
        photos={photos}
        onUploaded={(position) => setDone((previous) => new Set(previous).add(position))}
      />
      <GreffeRules />
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={pending}
        aria-busy={pending}
        aria-describedby={done.size < 3 ? "poses-count" : undefined}
      >
        {t("submit")}
      </Button>
      <p id="poses-count" className="sr-only">
        {done.size} / 3
      </p>
      <p role="alert" className="text-red-bright min-h-6 font-medium">
        {message}
      </p>
    </form>
  );
}
