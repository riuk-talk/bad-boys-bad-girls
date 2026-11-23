"use client";

import { ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { uploadPhotoAction, type StepState } from "@/app/[locale]/(app)/onboarding/actions";
import {
  prepareForUpload,
  useCutoutChoice,
  usePreloadCutout,
  warmCutout,
} from "@/components/onboarding/cutout-choice";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

type Photo = {
  id: string;
  position: number;
  status: "pending" | "approved" | "rejected";
  url: string | null;
};
const IDLE: StepState = { status: "idle" };

/**
 * Photos of the member. A Bad has up to 6; a Visitor's Permis shows a single photo, which can only
 * be replaced (SPEC v7 §5 bis; the database refuses other positions).
 */
export function PhotoManager({
  photos,
  single = false,
  positions = [0, 1, 2, 3, 4, 5],
}: {
  photos: Photo[];
  single?: boolean;
  /** Free positions this manager may fill (a Bad's extra photos: 3 to 5, PARCOURS-DESIGN §3). */
  positions?: readonly number[];
}) {
  const t = useTranslations("MyFiche");
  const errors = useTranslations("Onboarding.errors");
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(uploadPhotoAction, IDLE);
  const [preparing, setPreparing] = useState(false);
  const freePosition = single
    ? 0
    : positions.find((p) => !photos.some((photo) => photo.position === p));
  const replacing = single && photos.length > 0;
  const { choose, dialog } = useCutoutChoice(prepareForUpload);
  // Ma fiche: the cut-out runtime loads on the member's intent, not at every display (10h).
  const engine = usePreloadCutout({ eager: false });

  useEffect(() => {
    if (state.status === "done") {
      toast.show(t("photoAdded"), "success");
      router.refresh();
    }
  }, [state, router, t, toast]);

  async function onFile(file: File | undefined) {
    if (!file || freePosition === undefined) return;
    setPreparing(true);
    try {
      const compressed = await prepareForUpload(file);
      // The photo of the Permis (position 0) goes through the same preview as at the onboarding.
      const choice = freePosition === 0 ? await choose(compressed) : { blob: compressed };
      if (!choice) return;
      const blob = choice.blob;
      const form = new FormData();
      form.set("photo", blob, "photo");
      form.set("position", String(freePosition));
      startTransition(() => action(form));
    } catch {
      toast.show(errors("photoUnreadable"), "error");
    } finally {
      setPreparing(false);
      formRef.current?.reset();
    }
  }

  const error = state.status === "error" ? (state.fields?.photo ?? state.message) : undefined;

  return (
    <div className="space-y-4" data-cutout-engine={engine}>
      <ul className="grid grid-cols-3 gap-3">
        {photos.map((photo) => (
          <li key={photo.id} className="bg-ink-3 relative aspect-[4/5] overflow-hidden rounded-lg">
            {photo.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private file
              <img
                src={photo.url}
                alt={t("photoAlt", { number: photo.position + 1 })}
                className="size-full object-cover"
                loading="lazy"
              />
            ) : null}
            <Badge
              tone={
                photo.status === "approved"
                  ? "accent"
                  : photo.status === "rejected"
                    ? "red"
                    : "neutral"
              }
              className="absolute bottom-1 left-1 text-xs"
            >
              {t(`photoStatus.${photo.status}`)}
            </Badge>
          </li>
        ))}
      </ul>
      {freePosition !== undefined ? (
        <form ref={formRef}>
          <label
            htmlFor={`${id}-add`}
            onPointerDown={warmCutout}
            className="border-cream/80 has-focus-visible:outline-accent hover:bg-cream hover:text-ink inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 px-5 py-2 font-semibold has-focus-visible:outline-3"
          >
            <ImagePlus aria-hidden="true" className="size-5" />
            {replacing ? t("replacePhoto") : t("addPhoto")}
            <input
              id={`${id}-add`}
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={pending || preparing}
              onFocus={warmCutout}
              onChange={(event) => void onFile(event.target.files?.[0])}
            />
          </label>
        </form>
      ) : null}
      {dialog}
      <p aria-live="polite" className="min-h-6 text-sm">
        {error ? <span className="text-red-bright">{errors(error as "generic")}</span> : null}
      </p>
    </div>
  );
}
