"use client";

import { HandCoins, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useCallback, useEffect, useState } from "react";
import { loadDatesAction } from "@/app/[locale]/(app)/cavale-actions";
import { ackNudgeAction, closeConversationAction } from "@/app/[locale]/(app)/parloir-actions";
import type { ActionState } from "@/app/[locale]/(app)/relations-actions";
import { CavaleCard, CavaleForm } from "@/components/parloir/cavale";
import { Chat } from "@/components/parloir/chat";
import { Hygiaphone } from "@/components/parloir/plate";
import { SafetyActions } from "@/components/relations/safety-actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Link, useRouter } from "@/i18n/navigation";
import { accentForGender, type Accent } from "@/lib/accent";
import type { Dates, Proposal } from "@/lib/cavale";
import type { Conversation, Message } from "@/lib/parloir";

const IDLE: ActionState = { status: "idle" };

/** The Cavale card is read again every 15 s while the screen is shown, and after each answer. */
const DATES_POLL_MS = 15_000;

/**
 * Le Parloir sans horaire (maquette Permanent.dc.html, SPEC §13): the same conversation as the
 * visit, open without a schedule. The field stays visible; « Affaire classée » and « Proposer une
 * Cavale » sit above it, the Cavale card is pinned at the top (Phase 6).
 */
export function OpenParloir({
  conversation,
  messages,
  otherReadId,
  dates: initialDates,
  tz,
  me,
}: {
  conversation: Conversation;
  messages: Message[];
  otherReadId: number;
  dates: Dates | null;
  tz: string;
  me: { pseudo: string; accent: Accent };
}) {
  const t = useTranslations("Relations.parloir");
  const tc = useTranslations("Relations.cavale");
  const errorT = useTranslations("Relations.errors");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, close, closing] = useActionState(closeConversationAction, IDLE);
  const deleted = conversation.other_deleted === true || conversation.other.id === null;
  const other = {
    pseudo: conversation.other.pseudo ?? t("deletedAccount"),
    accent: accentForGender(conversation.other.gender),
  };
  const open = conversation.status === "open" && state.status !== "done";
  const [dates, setDates] = useState(initialDates);
  const [form, setForm] = useState<{ counter: Proposal | null } | null>(null);

  useEffect(() => {
    if (state.status === "done") router.refresh();
  }, [state.status, router]);

  // The relance is shown once (SPEC §13 [P1]): marked as seen as soon as it is on screen.
  const nudge = conversation.nudge === true && open && !deleted;
  useEffect(() => {
    if (nudge) void ackNudgeAction(conversation.id).catch(() => undefined);
  }, [nudge, conversation.id]);

  const refreshDates = useCallback(() => {
    loadDatesAction(conversation.id)
      .then((next) => {
        if (next) setDates(next);
      })
      .catch(() => undefined);
  }, [conversation.id]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshDates();
    }, DATES_POLL_MS);
    document.addEventListener("visibilitychange", refreshDates);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshDates);
    };
  }, [open, refreshDates]);

  const onCavaleDone = () => {
    setForm(null);
    refreshDates();
    // The accepted Cavale may lift the masking: the notice comes with the page.
    router.refresh();
  };

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
        {conversation.other.id && conversation.request_id ? (
          <SafetyActions
            memberId={conversation.other.id}
            pseudo={other.pseudo}
            reportType="visit_request"
            reportTarget={conversation.request_id}
            afterBlock="/visites"
          />
        ) : null}
      </header>

      {dates && open ? (
        <CavaleCard
          dates={dates}
          me={me}
          other={other}
          tz={tz}
          onChange={onCavaleDone}
          onCounter={(counter) => setForm({ counter })}
        />
      ) : null}

      {nudge && !dates?.pending && !dates?.accepted ? (
        <p
          role="note"
          className="border-line text-cream rounded-md border px-3 py-2 text-center text-sm"
        >
          {t("nudge")}
        </p>
      ) : null}

      {conversation.unmasked && open ? (
        <p role="note" className="text-cream flex items-center justify-center gap-2 text-[13px]">
          <HandCoins aria-hidden="true" className="text-accent size-4" />
          {t("moneyNotice")}
        </p>
      ) : null}

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
        canReport={!deleted}
        actions={
          open ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="text-cream hover:border-cream flex min-h-13 flex-1 flex-col items-center justify-center rounded-[6px] border-2 border-[#4a4a50] px-2"
              >
                <span className="font-display uppercase">{t("closeCase")}</span>
                <span className="text-grey text-[11px]">{t("closeCaseHint")}</span>
              </button>
              {dates?.can_propose ? (
                <button
                  type="button"
                  onClick={() => setForm({ counter: null })}
                  className="bg-accent text-ink flex min-h-13 flex-1 flex-col items-center justify-center rounded-[6px] px-2"
                >
                  <span className="font-display uppercase">{tc("propose")}</span>
                  <span className="text-[11px]">{tc("proposeHint")}</span>
                </button>
              ) : null}
            </div>
          ) : null
        }
      />

      {open ? null : (
        <p className="text-grey text-center text-sm" role="status">
          {deleted ? t("deletedConversation") : t("closedConversation")}
        </p>
      )}

      {form ? (
        <CavaleForm
          open
          conversationId={conversation.id}
          counter={form.counter}
          tz={tz}
          onClose={() => setForm(null)}
          onDone={onCavaleDone}
        />
      ) : null}

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
