"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { reportAction, type ActionState } from "@/app/[locale]/(app)/relations-actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { REPORT_CATEGORIES } from "@/lib/moderation";

const IDLE: ActionState = { status: "idle" };

type Props = {
  open: boolean;
  onClose: () => void;
  pseudo: string;
  /** What is reported: a Fiche, a Permis, a request of the Courrier or a message of the Parloir. */
  reportType: "profile" | "permit" | "visit_request" | "message" | "greffe_message";
  reportTarget: string;
};

/** Signaler (SPEC §10): a category, an optional comment, checked again in SQL. */
export function ReportDialog({ open, onClose, pseudo, reportType, reportTarget }: Props) {
  const t = useTranslations("Relations.safety");
  const errorT = useTranslations("Relations.errors");
  const [state, report, reporting] = useActionState(reportAction, IDLE);
  const id = useId();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        reportType === "message" || reportType === "greffe_message"
          ? t("reportMessageTitle", { pseudo })
          : t("reportTitle", { pseudo })
      }
    >
      {state.status === "done" ? (
        <div className="flex flex-col gap-4">
          <p role="status">{t("reportDone")}</p>
          <Button onClick={onClose}>{t("close")}</Button>
        </div>
      ) : (
        <form action={report} className="flex flex-col gap-4">
          <input type="hidden" name="type" value={reportType} />
          <input type="hidden" name="target" value={reportTarget} />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">{t("why")}</legend>
            {REPORT_CATEGORIES.map((category) => (
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
            {state.status === "error" ? errorT(state.message as "generic") : null}
          </p>
        </form>
      )}
    </Modal>
  );
}
