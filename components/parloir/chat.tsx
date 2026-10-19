"use client";

import { SendHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import {
  loadMessagesAction,
  markReadAction,
  sendMessageAction,
} from "@/app/[locale]/(app)/parloir-actions";
import type { ActionState } from "@/app/[locale]/(app)/relations-actions";
import { Stamp } from "@/components/brand/stamp";
import type { Accent } from "@/lib/accent";
import { cn } from "@/lib/cn";
import { MESSAGE_MAX, mergeMessages, readMarkFor, type Message } from "@/lib/parloir";
import { createClient } from "@/lib/supabase/browser";

const IDLE: ActionState = { status: "idle" };
/** Without a realtime connection the conversation is read every 3 s (SPEC §13). */
const FALLBACK_POLL_MS = 3000;
/** With one, a slow safety read in case an event was missed. */
const SAFETY_POLL_MS = 15000;

type Props = {
  conversationId: string;
  initial: Message[];
  /** How far the other has read (« Lu » under my last message, Phase 6a). */
  initialOtherReadId: number;
  /** Writing is possible (visit in progress with both present, or Permis permanent). */
  canWrite: boolean;
  me: { pseudo: string; accent: Accent };
  other: { pseudo: string; accent: Accent };
  /** The Visitor's pseudo, for « LE PARI DE … » and the note. */
  visitorPseudo: string;
  iAmVisitor: boolean;
};

/**
 * The conversation of the Parloir (maquettes Visite.dc.html, Permanent.dc.html): the bet on its
 * paper sheet, the Visitor's note, then the messages; bubbles outlined in the author's gender
 * colour. New messages come by Supabase Realtime (RLS: the two members), read again by
 * get_messages; without Realtime, every 3 s.
 */
export function Chat({
  conversationId,
  initial,
  initialOtherReadId,
  canWrite,
  me,
  other,
  visitorPseudo,
  iAmVisitor,
}: Props) {
  const t = useTranslations("Relations.parloir");
  const errorT = useTranslations("Relations.errors");
  const [messages, setMessages] = useState<Message[]>(initial);
  const [draft, setDraft] = useState("");
  const [otherReadId, setOtherReadId] = useState(initialOtherReadId);
  const lastId = useRef(initial.at(-1)?.id ?? 0);
  const markedId = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);

  const refresh = useCallback(async () => {
    const result = await loadMessagesAction(conversationId, lastId.current).catch(() => null);
    if (!result) return;
    setOtherReadId(result.otherReadId);
    const incoming = result.messages;
    if (incoming.length === 0) return;
    setMessages((current) => {
      const merged = mergeMessages(current, incoming);
      lastId.current = merged.at(-1)?.id ?? lastId.current;
      return merged;
    });
  }, [conversationId]);

  const [state, send, sending] = useActionState(
    async (previous: ActionState, form: FormData): Promise<ActionState> => {
      const result = await sendMessageAction(previous, form);
      if (result.status === "done") {
        setDraft("");
        await refresh();
      }
      return result;
    },
    IDLE,
  );

  useEffect(() => {
    void refresh();
    const supabase = createClient();
    let live = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`parloir:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          () => void refresh(),
        )
        .subscribe((status) => {
          live = status === "SUBSCRIBED";
        });
    } catch {
      // WebSocket refused (Safari throws on a blocked socket): the 3 s poll carries the conversation.
    }
    let elapsed = 0;
    const timer = window.setInterval(() => {
      elapsed += FALLBACK_POLL_MS;
      if (!live || elapsed >= SAFETY_POLL_MS) {
        elapsed = 0;
        void refresh();
      }
    }, FALLBACK_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [conversationId, refresh]);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // What is on screen is read: the conversation is marked up to its last message (Phase 6a).
  const newest = messages.at(-1)?.id ?? 0;
  useEffect(() => {
    const mark = () => {
      if (document.visibilityState !== "visible" || newest <= markedId.current) return;
      markedId.current = newest;
      void markReadAction(conversationId, newest).catch(() => {
        markedId.current = 0;
      });
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [conversationId, newest]);

  const readMark = readMarkFor(messages, otherReadId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol
        ref={listRef}
        aria-label={t("liveRegion")}
        aria-live="polite"
        className="parloir-glass flex flex-1 flex-col gap-3 overflow-y-auto rounded-md border border-[#2a2a2e] p-3"
      >
        {messages.map((message) => (
          <li key={message.id}>
            <Entry
              message={message}
              me={me}
              other={other}
              visitorPseudo={visitorPseudo}
              iAmVisitor={iAmVisitor}
            />
            {message.id === readMark ? (
              <p className="text-grey mt-0.5 text-right text-[11px]">{t("read")}</p>
            ) : null}
          </li>
        ))}
      </ol>
      {canWrite ? (
        <form action={send} className="mt-3 flex items-end gap-2">
          <input type="hidden" name="conversation" value={conversationId} />
          <label className="flex flex-1 flex-col gap-1">
            <span className="sr-only">{t("messageLabel")}</span>
            <textarea
              name="body"
              rows={2}
              maxLength={MESSAGE_MAX}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("messageLabel")}
              className="border-line bg-ink focus:border-accent min-h-12 w-full resize-none rounded-md border p-2.5 text-[15px] focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={sending || draft.trim() === ""}
            aria-label={sending ? t("sending") : t("send")}
            className="bg-accent text-ink flex size-12 shrink-0 items-center justify-center rounded-md disabled:opacity-50"
          >
            <SendHorizontal aria-hidden="true" className="size-5" />
          </button>
        </form>
      ) : null}
      <p role="alert" className="text-red-bright min-h-5 text-sm">
        {state.status === "error" ? errorT(state.message as "generic") : null}
      </p>
    </div>
  );
}

function Entry({
  message,
  me,
  other,
  visitorPseudo,
  iAmVisitor,
}: {
  message: Message;
  me: Props["me"];
  other: Props["other"];
  visitorPseudo: string;
  iAmVisitor: boolean;
}) {
  const t = useTranslations("Relations.parloir");
  const payload = message.payload;
  if (message.kind === "system" && payload?.type === "bet") {
    return (
      <article className="bg-cream text-ink relative mx-auto flex max-w-sm flex-col gap-1.5 rounded-[3px] p-3.5 shadow">
        <p className="font-stamp text-xs tracking-[0.2em]">
          {t("betTitle", { pseudo: visitorPseudo.toUpperCase() })}
        </p>
        <p className="font-stamp text-[15px]">« {payload.charge} »</p>
        {payload.correct ? null : (
          <p className="text-[13px] text-[#4a4038]">
            {t("betTrue", { charge: payload.true_charge ?? "" })}
          </p>
        )}
        <span className="absolute -top-3 -right-2">
          <Stamp
            kind={payload.correct ? "rightGuess" : "wrongGuess"}
            surface="paper"
            size="sm"
            tilt={-8}
          />
        </span>
      </article>
    );
  }
  if (message.kind === "system" && payload?.type === "note") {
    const author = iAmVisitor ? me : other;
    return (
      <Bubble
        mine={message.mine}
        accent={author.accent}
        name={t("noteBy", { pseudo: visitorPseudo })}
        text={payload.text}
      />
    );
  }
  if (message.kind === "system") {
    return (
      <p className="text-grey text-center text-[13px]">
        {payload?.type === "released" ? t("markReleased") : t("markClosed")}
      </p>
    );
  }
  const author = message.mine ? me : other;
  return (
    <Bubble
      mine={message.mine}
      accent={author.accent}
      name={author.pseudo}
      text={message.body ?? ""}
    />
  );
}

function Bubble({
  mine,
  accent,
  name,
  text,
}: {
  mine: boolean;
  accent: Accent;
  name: string;
  text: string;
}) {
  return (
    <div
      data-accent={accent}
      className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}
    >
      <span className="font-stamp text-accent text-[11px] tracking-[0.15em] uppercase">{name}</span>
      <p
        className={cn(
          "border-accent max-w-[85%] rounded-lg border-2 bg-[#0e0e10]/80 px-3 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap",
          mine ? "rounded-br-sm" : "rounded-bl-sm",
        )}
      >
        {text}
      </p>
    </div>
  );
}
