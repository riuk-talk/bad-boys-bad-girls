"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { decideVisitRequestAction, type ActionState } from "@/app/[locale]/(app)/relations-actions";
import { Stamp } from "@/components/brand/stamp";
import { buttonClasses } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

const IDLE: ActionState = { status: "idle" };

/**
 * « Accepter la visite » or « Affaire classée » (SPEC §7). Accepting means proposing the Heures
 * de visite (Phase 5b): the button leads to that screen, where the acceptance is recorded with
 * the slots. Classing is immediate.
 */
export function Decision({ requestId, pseudo }: { requestId: string; pseudo: string }) {
  const t = useTranslations("Relations.letter");
  const errorT = useTranslations("Relations.errors");
  const [dismissState, dismiss, dismissing] = useActionState(decideVisitRequestAction, IDLE);

  if (dismissState.status === "done") {
    return (
      <div className="flex flex-col items-center gap-3 text-center" role="status">
        <Stamp kind="dismissed" surface="dark" size="lg" tilt={-6} animated />
        <p className="text-cream/90">{t("dismissedBody", { pseudo })}</p>
        <Link href="/courrier" className={buttonClasses("secondary", "md")}>
          {t("backToMailbox")}
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <Link
        href={`/courrier/${requestId}/heures`}
        className={buttonClasses(
          "primary",
          "lg",
          "font-display w-full rounded-[4px] text-xl uppercase",
        )}
      >
        {t("accept")}
      </Link>
      <form action={dismiss}>
        <input type="hidden" name="request" value={requestId} />
        <input type="hidden" name="accept" value="0" />
        <button
          type="submit"
          disabled={dismissing}
          className="font-display text-cream hover:border-cream flex min-h-12 w-full items-center justify-center rounded-[4px] border-2 border-[#4a4a50] text-[17px] uppercase"
        >
          {t("dismiss")}
        </button>
      </form>
      <p className="text-grey text-center text-xs">{t("dismissHint")}</p>
      <p role="alert" className="text-red-bright min-h-5 text-sm">
        {dismissState.status === "error" ? errorT(dismissState.message as "generic") : null}
      </p>
    </div>
  );
}
