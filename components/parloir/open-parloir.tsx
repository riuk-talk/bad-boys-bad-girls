"use client";

import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { closeConversationAction } from "@/app/[locale]/(app)/parloir-actions";
import type { ActionState } from "@/app/[locale]/(app)/relations-actions";
import { Chat } from "@/components/parloir/chat";
import { Hygiaphone } from "@/components/parloir/plate";
import { SafetyActions } from "@/components/relations/safety-actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Link, useRouter } from "@/i18n/navigation";
import { accentForGender, type Accent } from "@/lib/accent";
import type { Conversation, Message } from "@/lib/parloir";

const IDLE: ActionState = { status: "idle" };

/**
 * Le Parloir sans horaire (maquette Permanent.dc.html, SPEC §13): the same conversation as the
 * visit, open without a schedule. The field stays visible; « Affaire classée » sits above it.
 * La Cavale (a real date) comes with Phase 6.
 */
export function OpenParloir({
  conversation,
  messages,
  otherReadId,
  me,
}: {
  conversation: Conversation;
  messages: Message[];
  otherReadId: number;
  me: { pseudo: string; accent: Accent };
}) {
  const t = useTranslations("Relations.parloir");
  const errorT = useTranslations("Relations.errors");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, close, closing] = useActionState(closeConversationAction, IDLE);
  const other = {
    pseudo: conversation.other.pseudo,
    accent: accentForGender(conversation.other.gender),
  };
  const open = conversation.status === "open" && state.status !== "done";

  useEffect(() => {
    if (state.status === "done") router.refresh();
  }, [state.status, router]);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-2xl flex-col gap-3 px-4 py-4 sm:px-6">
      <header className="parloir-plate flex flex-col gap-1.5 rounded-md px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <Hygiaphone />
          <h1 className="font-display text-center text-lg tracking-wide uppercase">
            {t("plateOpen")}
          </h1>
          <Hygiaphone />
        </div>
        <p className="font-stamp text-grey text-center text-[11px] tracking-[0.15em]">
          {t("withPermanent", { pseudo: other.pseudo.toUpperCase() })}
        </p>
        <SafetyActions
          memberId={conversation.other.id}
          pseudo={other.pseudo}
          reportType="visit_request"
          reportTarget={conversation.request_id}
          afterBlock="/visites"
        />
      </header>

      <p className="text-grey flex items-center justify-center gap-2 text-[13px]">
        <ShieldCheck aria-hidden="true" className="size-4" />
        {t("safetyNote")}
        <Link href="/conseils-securite" className="text-cream underline underline-offset-4">
          {t("safetyLink")}
        </Link>
      </p>

      <Chat
        conversationId={conversation.id}
        initial={messages}
        initialOtherReadId={otherReadId}
        canWrite={open}
        me={me}
        other={other}
        visitorPseudo={conversation.i_am_bad ? other.pseudo : me.pseudo}
        iAmVisitor={!conversation.i_am_bad}
      />

      {open ? (
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="font-display text-cream hover:border-cream min-h-11 rounded-[4px] border-2 border-[#4a4a50] px-4 uppercase"
          >
            {t("closeCase")}
          </button>
          <span className="text-grey text-xs">{t("cavaleSoon")}</span>
        </div>
      ) : (
        <p className="text-grey text-center text-sm" role="status">
          {t("closedConversation")}
        </p>
      )}

      <Modal
        open={confirming && open}
        onClose={() => setConfirming(false)}
        title={t("closeConfirmTitle", { pseudo: other.pseudo })}
      >
        <form action={close} className="flex flex-col gap-4">
          <input type="hidden" name="conversation" value={conversation.id} />
          <p>{t("closeConfirmBody")}</p>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={closing} className={buttonClasses("danger", "md")}>
              {t("closeConfirm")}
            </button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
          </div>
          <p role="alert" className="text-red-bright min-h-5 text-sm">
            {state.status === "error" ? errorT(state.message as "generic") : null}
          </p>
        </form>
      </Modal>
    </div>
  );
}
