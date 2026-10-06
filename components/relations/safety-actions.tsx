"use client";

import { Ban, Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";
import {
  blockAction,
  reportAction,
  type ActionState,
} from "@/app/[locale]/(app)/relations-actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

const IDLE: ActionState = { status: "idle" };
const CATEGORIES = [
  "fake_profile",
  "minor",
  "harassment",
  "sexual_content",
  "violence_threat",
  "scam",
  "other",
] as const;

type Props = {
  /** Who is reported or blocked. */
  memberId: string;
  pseudo: string;
  /** What is reported: the Fiche (profile), the Permis, or a request of the Courrier. */
  reportType: "profile" | "permit" | "visit_request";
  reportTarget: string;
  /** Where the member goes once they blocked someone (that person disappears everywhere). */
  afterBlock: "/promenade" | "/courrier";
};

/** Signaler and Bloquer, in simple words (SPEC §10), from a Fiche, a Permis or a request. */
export function SafetyActions({ memberId, pseudo, reportType, reportTarget, afterBlock }: Props) {
  const t = useTranslations("Relations.safety");
  const errorT = useTranslations("Relations.errors");
  const [dialog, setDialog] = useState<"report" | "block" | null>(null);
  const [reportState, report, reporting] = useActionState(reportAction, IDLE);
  const [blockState, block, blocking] = useActionState(blockAction, IDLE);
  const id = useId();

  const linkClass = "text-grey hover:text-cream inline-flex min-h-11 items-center gap-1.5 text-sm";
  return (
    <div className="flex justify-center gap-5">
      <button type="button" className={linkClass} onClick={() => setDialog("report")}>
        <Flag aria-hidden="true" className="size-4" />
        {t("report")}
      </button>
      <button type="button" className={linkClass} onClick={() => setDialog("block")}>
        <Ban aria-hidden="true" className="size-4" />
        {t("block")}
      </button>

      <Modal
        open={dialog === "report"}
        onClose={() => setDialog(null)}
        title={t("reportTitle", { pseudo })}
      >
        {reportState.status === "done" ? (
          <div className="flex flex-col gap-4">
            <p role="status">{t("reportDone")}</p>
            <Button onClick={() => setDialog(null)}>{t("close")}</Button>
          </div>
        ) : (
          <form action={report} className="flex flex-col gap-4">
            <input type="hidden" name="type" value={reportType} />
            <input type="hidden" name="target" value={reportTarget} />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">{t("why")}</legend>
              {CATEGORIES.map((category) => (
                <label key={category} className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="category"
                    value={category}
                    className="accent-accent size-5"
                  />
                  {t(`category_${category}`)}
                </label>
              ))}
            </fieldset>
            <label htmlFor={`${id}-comment`} className="text-sm font-semibold">
              {t("comment")} <span className="text-grey font-normal">{t("optional")}</span>
            </label>
            <textarea
              id={`${id}-comment`}
              name="comment"
              rows={3}
              maxLength={500}
              className="border-line bg-ink focus:border-accent -mt-2 w-full resize-none rounded-md border p-2.5 focus:outline-none"
            />
            <p className="text-grey text-xs">{t("reportPrivacy")}</p>
            <button type="submit" disabled={reporting} className={buttonClasses("primary", "md")}>
              {t("reportSubmit")}
            </button>
            <p role="alert" className="text-red-bright min-h-5 text-sm">
              {reportState.status === "error" ? errorT(reportState.message as "generic") : null}
            </p>
          </form>
        )}
      </Modal>

      <Modal
        open={dialog === "block"}
        onClose={() => setDialog(null)}
        title={t("blockTitle", { pseudo })}
      >
        <form action={block} className="flex flex-col gap-4">
          <input type="hidden" name="target" value={memberId} />
          <input type="hidden" name="next" value={afterBlock} />
          <p>{t("blockBody", { pseudo })}</p>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={blocking} className={buttonClasses("danger", "md")}>
              {t("blockSubmit")}
            </button>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t("cancel")}
            </Button>
          </div>
          <p role="alert" className="text-red-bright min-h-5 text-sm">
            {blockState.status === "error" ? errorT(blockState.message as "generic") : null}
          </p>
        </form>
      </Modal>
    </div>
  );
}
