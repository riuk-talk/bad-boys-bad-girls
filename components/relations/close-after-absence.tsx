"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { closeAfterAbsenceAction } from "@/app/[locale]/(app)/hours-actions";
import type { ActionState } from "@/app/[locale]/(app)/relations-actions";
import { useRouter } from "@/i18n/navigation";

const IDLE: ActionState = { status: "idle" };

/**
 * After the Visitor's absence the Bad may class the case instead of proposing new slots (SPEC
 * §7 ter); neither is required. A native disclosure asks for confirmation first.
 */
export function CloseAfterAbsence({ requestId, pseudo }: { requestId: string; pseudo: string }) {
  const t = useTranslations("Relations.schedule");
  const errorT = useTranslations("Relations.errors");
  const router = useRouter();
  const [state, close, closing] = useActionState(closeAfterAbsenceAction, IDLE);

  useEffect(() => {
    if (state.status === "done") router.refresh();
  }, [state.status, router]);

  if (state.status === "done") {
    return (
      <p role="status" className="text-cream/90 text-sm">
        {t("closedAfterAbsence", { pseudo })}
      </p>
    );
  }
  return (
    <details className="text-sm">
      <summary className="text-cream min-h-11 cursor-pointer content-center underline underline-offset-4">
        {t("closeAfterAbsence")}
      </summary>
      <form action={close} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="request" value={requestId} />
        <p className="text-grey">{t("closeAfterAbsenceHint", { pseudo })}</p>
        <button
          type="submit"
          disabled={closing}
          className="font-display text-cream hover:border-cream min-h-11 rounded-[4px] border-2 border-[#4a4a50] uppercase"
        >
          {t("closeAfterAbsenceConfirm")}
        </button>
        <p role="alert" className="text-red-bright min-h-5">
          {state.status === "error" ? errorT(state.message as "generic") : null}
        </p>
      </form>
    </details>
  );
}
