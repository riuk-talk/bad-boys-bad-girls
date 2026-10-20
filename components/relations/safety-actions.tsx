"use client";

import { Ban, Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { blockAction, type ActionState } from "@/app/[locale]/(app)/relations-actions";
import { ReportDialog } from "@/components/relations/report-dialog";
import { Button, buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

const IDLE: ActionState = { status: "idle" };

type Props = {
  /** Who is reported or blocked. */
  memberId: string;
  pseudo: string;
  /** What is reported: the Fiche (profile), the Permis, or a request of the Courrier. */
  reportType: "profile" | "permit" | "visit_request";
  reportTarget: string;
  /** Where the member goes once they blocked someone (that person disappears everywhere). */
  afterBlock: "/promenade" | "/courrier" | "/visites";
};

/** Signaler and Bloquer, in simple words (SPEC §10), from a Fiche, a Permis or a request. */
export function SafetyActions({ memberId, pseudo, reportType, reportTarget, afterBlock }: Props) {
  const t = useTranslations("Relations.safety");
  const errorT = useTranslations("Relations.errors");
  const [dialog, setDialog] = useState<"report" | "block" | null>(null);
  const [blockState, block, blocking] = useActionState(blockAction, IDLE);

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

      <ReportDialog
        open={dialog === "report"}
        onClose={() => setDialog(null)}
        pseudo={pseudo}
        reportType={reportType}
        reportTarget={reportTarget}
      />

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
