"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { cancelVisitAction } from "@/app/[locale]/(app)/hours-actions";
import type { ActionState } from "@/app/[locale]/(app)/relations-actions";
import { useRouter } from "@/i18n/navigation";

const IDLE: ActionState = { status: "idle" };

/**
 * Cancelling a scheduled visit (SPEC §7 bis, 4): either side, until the start, with a neutral
 * message to the other. A native disclosure asks for confirmation first.
 */
export function CancelVisit({ visitId, pseudo }: { visitId: string; pseudo: string }) {
  const t = useTranslations("Relations.schedule");
  const errorT = useTranslations("Relations.errors");
  const router = useRouter();
  const [state, cancel, cancelling] = useActionState(cancelVisitAction, IDLE);

  useEffect(() => {
    if (state.status === "done") router.refresh();
  }, [state.status, router]);

  if (state.status === "done") {
    return (
      <p role="status" className="text-cream/90 text-sm">
        {t("cancelledDone", { pseudo })}
      </p>
    );
  }
  return (
    <details className="text-sm">
      <summary className="text-cream min-h-11 cursor-pointer content-center underline underline-offset-4">
        {t("cancel")}
      </summary>
      <form action={cancel} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="visit" value={visitId} />
        <p className="text-grey">{t("cancelHint", { pseudo })}</p>
        <button
          type="submit"
          disabled={cancelling}
          className="font-display text-cream hover:border-cream min-h-11 rounded-[4px] border-2 border-[#4a4a50] uppercase"
        >
          {t("cancelConfirm")}
        </button>
        <p role="alert" className="text-red-bright min-h-5">
          {state.status === "error" ? errorT(state.message as "generic") : null}
        </p>
      </form>
    </details>
  );
}
