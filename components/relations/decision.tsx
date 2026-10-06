"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { decideVisitRequestAction, type ActionState } from "@/app/[locale]/(app)/relations-actions";
import { Stamp } from "@/components/brand/stamp";
import { buttonClasses } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

const IDLE: ActionState = { status: "idle" };

/**
 * « Accepter la visite » or « Affaire classée » (SPEC §7). Phase 4: accepted without visiting
 * hours, the request stays « accepted » until Phase 5 brings the Heures de visite.
 */
export function Decision({
  requestId,
  pseudo,
  accepted,
}: {
  requestId: string;
  pseudo: string;
  accepted: boolean;
}) {
  const t = useTranslations("Relations.letter");
  const errorT = useTranslations("Relations.errors");
  const [acceptState, accept, accepting] = useActionState(decideVisitRequestAction, IDLE);
  const [dismissState, dismiss, dismissing] = useActionState(decideVisitRequestAction, IDLE);

  if (accepted || acceptState.status === "done") {
    return (
      <div className="flex flex-col items-center gap-3 text-center" role="status">
        <Stamp
          kind="visitAccepted"
          surface="dark"
          size="lg"
          tilt={-6}
          animated={acceptState.status === "done"}
        />
        <p className="text-cream/90">{t("acceptedBody", { pseudo })}</p>
        <Link href="/courrier" className={buttonClasses("secondary", "md")}>
          {t("backToMailbox")}
        </Link>
      </div>
    );
  }
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
  const error =
    acceptState.status === "error"
      ? acceptState
      : dismissState.status === "error"
        ? dismissState
        : null;
  return (
    <div className="flex flex-col gap-2.5">
      <form action={accept}>
        <input type="hidden" name="request" value={requestId} />
        <input type="hidden" name="accept" value="1" />
        <button
          type="submit"
          disabled={accepting || dismissing}
          className={buttonClasses(
            "primary",
            "lg",
            "font-display w-full rounded-[4px] text-xl uppercase",
          )}
        >
          {t("accept")}
        </button>
      </form>
      <form action={dismiss}>
        <input type="hidden" name="request" value={requestId} />
        <input type="hidden" name="accept" value="0" />
        <button
          type="submit"
          disabled={accepting || dismissing}
          className="font-display text-cream hover:border-cream flex min-h-12 w-full items-center justify-center rounded-[4px] border-2 border-[#4a4a50] text-[17px] uppercase"
        >
          {t("dismiss")}
        </button>
      </form>
      <p className="text-grey text-center text-xs">{t("dismissHint")}</p>
      <p role="alert" className="text-red-bright min-h-5 text-sm">
        {error ? errorT(error.message as "generic") : null}
      </p>
    </div>
  );
}
