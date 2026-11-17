"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { Ellipsis, RotateCcw, SendHorizontal } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  loadMessagesAction,
  markReadAction,
  postMessageAction,
} from "@/app/[locale]/(app)/parloir-actions";
import { Stamp } from "@/components/brand/stamp";
import { ReportDialog } from "@/components/relations/report-dialog";
import type { Accent } from "@/lib/accent";
import { cn } from "@/lib/cn";
import { MESSAGE_MAX, mergeMessages, readMarkFor, type Message } from "@/lib/parloir";
import {
  TYPING_SHOWN_MS,
  dayKey,
  dayLabel,
  dayStarts,
  firstUnreadId,
  reconcilePending,
  timeLabel,
  typingDue,
  type Pending,
  type ReadState,
} from "@/lib/parloir-thread";
import { createClient } from "@/lib/supabase/browser";

/** Without a realtime connection the conversation is read every 3 s (SPEC §13). */
const FALLBACK_POLL_MS = 3000;
/** With one, a slow safety read in case an event was missed (Parloir sans horaire). */
const SAFETY_POLL_MS = 15000;
/** During a visit in progress (30 minutes), the safety read comes every 5 s. */
const VISIT_SAFETY_POLL_MS = 5000;
/** A press this long on a bubble opens its actions (mobile, 9l). */
const LONG_PRESS_MS = 500;

type Props = {
  conversationId: string;
  initial: Message[];
  /** How far each one had read when the screen was opened (« Lu », « Nouveaux messages »). */
  readState: ReadState;
  /** The member's time zone: the hour under each message and the day separators. */
  tz: string;
  /** Writing is possible (visit in progress with both present, or Permis permanent). */
  canWrite: boolean;
  me: { pseudo: string; accent: Accent };
  other: { pseudo: string; accent: Accent };
  /** The Visitor's pseudo, for « LE PARI DE … » and the note. */
  visitorPseudo: string;
  iAmVisitor: boolean;
  /** Shown between the conversation and the field (Parloir sans horaire: the Cavale). */
  actions?: ReactNode;
  /** A message of the other can be reported (not once their account is deleted). */
  canReport?: boolean;
  /** A visit in progress: the safety read every 5 s rather than 15 s. */
  liveVisit?: boolean;
};

/**
 * The conversation of the Parloir (maquettes Visite.dc.html, Permanent.dc.html): the bet on its
 * paper sheet, the Visitor's note, then the messages; bubbles outlined in the author's gender
 * colour, the hour under each one, a separator for each day and « Nouveaux messages » at the
 * first one not read yet. New messages come by Supabase Realtime (RLS: the two members), read
 * again by get_messages; without Realtime, every 3 s. A message sent shows at once and waits for
 * the server (« Envoi… », then « Réessayer » if it failed); « … écrit » goes through a private
 * Realtime Broadcast channel of the conversation, never through the database (9l).
 */
export function Chat({
  conversationId,
  initial,
  readState,
  tz,
  canWrite,
  me,
  other,
  visitorPseudo,
  iAmVisitor,
  actions,
  canReport = true,
  liveVisit = false,
}: Props) {
  const t = useTranslations("Relations.parloir");
  const errorT = useTranslations("Relations.errors");
  const locale = useLocale();
  const [messages, setMessages] = useState<Message[]>(initial);
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [otherReadId, setOtherReadId] = useState(readState.otherReadId);
  const [reporting, setReporting] = useState<number | null>(null);
  const [othersTyping, setOthersTyping] = useState(false);
  // Placed once, at the opening: the first message of the other not read before it.
  const [unreadFrom] = useState(() => firstUnreadId(initial, readState.myReadId));
  const [now] = useState(() => Date.now());
  const lastId = useRef(initial.at(-1)?.id ?? 0);
  const messagesRef = useRef(initial);
  const markedId = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const markerRef = useRef<HTMLLIElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const typingChannel = useRef<RealtimeChannel | null>(null);
  const typingSent = useRef(0);
  const typingTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const refresh = useCallback(async () => {
    const result = await loadMessagesAction(conversationId, lastId.current).catch(() => null);
    if (!result) return;
    setOtherReadId(result.otherReadId);
    const incoming = result.messages;
    if (incoming.length === 0) return;
    // A message of the other has arrived: they are no longer writing it.
    if (incoming.some((message) => !message.mine)) setOthersTyping(false);
    setMessages((current) => {
      const merged = mergeMessages(current, incoming);
      lastId.current = merged.at(-1)?.id ?? lastId.current;
      return merged;
    });
  }, [conversationId]);

  const safetyMs = liveVisit ? VISIT_SAFETY_POLL_MS : SAFETY_POLL_MS;
  useEffect(() => {
    const supabase = createClient();
    let live = false;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let lastRead = 0;
    const read = () => {
      lastRead = Date.now();
      void refresh();
    };
    read();
    void (async () => {
      // The channel is joined with the member's own token. Joined before the session was read, it
      // went as anon, who cannot read the messages: Realtime refused the subscription (« invalid
      // column for filter ») and no insert ever came; only the safety read showed them.
      await supabase.realtime.setAuth().catch(() => undefined);
      if (cancelled) return;
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
          // Live only once the database confirms the subscription (« Subscribed to PostgreSQL »):
          // the channel reports SUBSCRIBED even when Realtime refused it, and the conversation
          // then went on the slow safety read.
          .on("system", {}, (payload: { extension?: string; status?: string }) => {
            if (payload.extension !== "postgres_changes") return;
            const wasLive = live;
            live = payload.status === "ok";
            // (Re)opened: what was written while it was not listening.
            if (live && !wasLive) read();
          })
          .subscribe((status) => {
            if (status !== "SUBSCRIBED") live = false;
          });
      } catch {
        // WebSocket refused (Safari throws on a blocked socket): the 3 s poll carries the conversation.
      }
    })();
    const timer = window.setInterval(() => {
      if (Date.now() - lastRead >= (live ? safetyMs : FALLBACK_POLL_MS)) read();
    }, 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") read();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [conversationId, refresh, safetyMs]);

  // « … écrit »: a private Broadcast channel of the conversation (Realtime Authorization, the two
  // members only), nothing written in the database. Shown 5 s after the last signal.
  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    try {
      channel = supabase.channel(`parloir-typing:${conversationId}`, {
        config: { private: true, broadcast: { self: false } },
      });
      channel.on("broadcast", { event: "typing" }, ({ payload }) => {
        window.clearTimeout(typingTimer.current);
        if ((payload as { stop?: boolean } | undefined)?.stop) {
          setOthersTyping(false);
          return;
        }
        setOthersTyping(true);
        typingTimer.current = window.setTimeout(() => setOthersTyping(false), TYPING_SHOWN_MS);
      });
      const joining = channel;
      // The channel is private: it is joined with the member's own token.
      void supabase.realtime
        .setAuth()
        .then(() => joining.subscribe())
        .catch(() => undefined);
      typingChannel.current = channel;
    } catch {
      // No WebSocket: no « … écrit », the conversation itself goes on.
    }
    return () => {
      window.clearTimeout(typingTimer.current);
      typingChannel.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const signalTyping = useCallback((stop: boolean) => {
    const channel = typingChannel.current;
    if (!channel) return;
    if (stop) {
      if (typingSent.current === 0) return;
      typingSent.current = 0;
      void channel.send({ type: "broadcast", event: "typing", payload: { stop: true } });
      return;
    }
    const at = Date.now();
    if (!typingDue(typingSent.current, at)) return;
    typingSent.current = at;
    void channel.send({ type: "broadcast", event: "typing", payload: {} });
  }, []);

  const deliver = useCallback(
    async (item: Pending) => {
      const result = await postMessageAction(conversationId, item.body).catch(() => null);
      if (result?.ok) {
        setPending((list) => list.map((p) => (p.key === item.key ? { ...p, id: result.id } : p)));
        setError(null);
        void refresh();
        return;
      }
      setPending((list) =>
        list.map((p) => (p.key === item.key ? { ...p, status: "failed" as const } : p)),
      );
      setError(result && !result.ok ? result.error : "generic");
    },
    [conversationId, refresh],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (body === "") return;
    const item: Pending = {
      key: crypto.randomUUID(),
      body,
      status: "sending",
      after: lastId.current,
      createdAt: new Date().toISOString(),
    };
    setPending((list) => [...reconcilePending(list, messagesRef.current), item]);
    setDraft("");
    signalTyping(true);
    void deliver(item);
  };

  const retry = (item: Pending) => {
    const again: Pending = { ...item, status: "sending", after: lastId.current };
    setPending((list) => list.map((p) => (p.key === item.key ? again : p)));
    void deliver(again);
  };

  // The list scrolls inside a bounded height, so the composer and the actions stay on screen; on
  // arrival, the bottom of the conversation is shown above the tab bar (scroll-padding of
  // globals.css), as in any messaging app.
  useEffect(() => {
    const root = rootRef.current;
    const bar = document.querySelector("[data-tab-bar]");
    const limit = bar ? bar.getBoundingClientRect().top : window.innerHeight;
    if (root && root.getBoundingClientRect().bottom > limit) root.scrollIntoView({ block: "end" });
  }, []);

  const shown = reconcilePending(pending, messages);
  const count = messages.length + shown.length;
  // At the opening, the list starts at « Nouveaux messages » when there is one; then it follows
  // the newest message. Only the list scrolls: scrollIntoView would also scroll the window and
  // push the composer under the tab bar.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const marker = markerRef.current;
    if (!scrolled.current && marker) {
      scrolled.current = true;
      list.scrollTop = Math.max(0, marker.offsetTop - 8);
      return;
    }
    scrolled.current = true;
    list.scrollTop = list.scrollHeight;
  }, [count]);

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
  const starts = dayStarts(messages, tz);
  const today = dayKey(now, tz);
  const last = messages.at(-1);
  const todaySeparator = shown.length > 0 && (!last || dayKey(last.created_at, tz) !== today);
  const dayText = (iso: string) => {
    const label = dayLabel(iso, now, tz, locale);
    return label.kind === "date" ? label.text : t(label.kind);
  };

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <ol
        ref={listRef}
        aria-label={t("liveRegion")}
        aria-live="polite"
        // A scrolling region is reached with the keyboard (Safari does not do it by itself).
        tabIndex={0}
        className="parloir-glass focus-visible:outline-accent relative flex max-h-[calc(100dvh-26rem)] min-h-48 flex-1 flex-col gap-3 overflow-y-auto rounded-md border border-[#2a2a2e] p-3 focus-visible:outline-2"
      >
        {messages.map((message) => (
          <Fragment key={message.id}>
            {starts.has(message.id) ? <DaySeparator text={dayText(message.created_at)} /> : null}
            {message.id === unreadFrom ? (
              <li
                ref={markerRef}
                className="text-accent flex items-center gap-2 text-[12px] font-semibold tracking-[0.12em] uppercase"
                data-testid="new-messages"
              >
                <span aria-hidden="true" className="bg-accent h-px flex-1" />
                {t("newMessages")}
                <span aria-hidden="true" className="bg-accent h-px flex-1" />
              </li>
            ) : null}
            <li data-message-id={message.id}>
              <Entry
                message={message}
                me={me}
                other={other}
                visitorPseudo={visitorPseudo}
                iAmVisitor={iAmVisitor}
                time={timeLabel(message.created_at, tz)}
                onReport={
                  canReport && message.kind === "text" && !message.mine && message.body !== null
                    ? () => setReporting(message.id)
                    : undefined
                }
              />
              {message.id === readMark ? (
                <p className="text-grey mt-0.5 text-right text-[11px]">{t("read")}</p>
              ) : null}
            </li>
          </Fragment>
        ))}
        {todaySeparator ? <DaySeparator text={t("today")} /> : null}
        {shown.map((item) => (
          <li key={item.key} data-pending={item.status}>
            <Bubble
              mine
              accent={me.accent}
              name={me.pseudo}
              text={item.body}
              time={timeLabel(item.createdAt, tz)}
            />
            <div className="mt-0.5 flex items-center justify-end gap-2 text-[11px]">
              {item.status === "sending" ? (
                <span className="text-grey">{t("sending")}</span>
              ) : (
                <>
                  <span className="text-red-bright">{t("notSent")}</span>
                  <button
                    type="button"
                    onClick={() => retry(item)}
                    className="text-cream hover:text-accent inline-flex min-h-11 items-center gap-1 px-1 text-[13px] underline underline-offset-4"
                  >
                    <RotateCcw aria-hidden="true" className="size-3.5" />
                    {t("retry")}
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      {canWrite ? (
        <p
          aria-live="polite"
          className="text-grey min-h-5 pt-1 text-[13px] italic"
          data-testid="typing"
        >
          {othersTyping ? t("typing", { pseudo: other.pseudo }) : null}
        </p>
      ) : null}
      {actions}
      {canWrite ? (
        <form onSubmit={submit} className="mt-2 flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="sr-only">{t("messageLabel")}</span>
            <textarea
              name="body"
              rows={2}
              maxLength={MESSAGE_MAX}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                signalTyping(event.target.value.trim() === "");
              }}
              placeholder={t("messageLabel")}
              className="border-line bg-ink focus:border-accent min-h-12 w-full resize-none rounded-md border p-2.5 text-[15px] focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={draft.trim() === ""}
            aria-label={t("send")}
            className="bg-accent text-ink flex size-12 shrink-0 items-center justify-center rounded-md disabled:opacity-50"
          >
            <SendHorizontal aria-hidden="true" className="size-5" />
          </button>
        </form>
      ) : null}
      <p role="alert" className="text-red-bright min-h-5 text-sm">
        {error ? errorT(error as "generic") : null}
      </p>
      {reporting !== null ? (
        <ReportDialog
          key={reporting}
          open
          onClose={() => setReporting(null)}
          pseudo={other.pseudo}
          reportType="message"
          reportTarget={String(reporting)}
        />
      ) : null}
    </div>
  );
}

/** « Aujourd'hui », « Hier », « lundi 2 novembre »: before the first message of each day. */
function DaySeparator({ text }: { text: string }) {
  return (
    <li className="text-grey flex items-center gap-2 text-[12px]" data-testid="day-separator">
      <span aria-hidden="true" className="h-px flex-1 bg-[#2a2a2e]" />
      <span className="first-letter:uppercase">{text}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-[#2a2a2e]" />
    </li>
  );
}

function Entry({
  message,
  me,
  other,
  visitorPseudo,
  iAmVisitor,
  time,
  onReport,
}: {
  message: Message;
  me: Props["me"];
  other: Props["other"];
  visitorPseudo: string;
  iAmVisitor: boolean;
  time: string;
  onReport?: () => void;
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
        time={time}
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
      text={
        message.body ?? (payload?.type === "removed" ? t("messageDeleted") : t("messageRemoved"))
      }
      time={time}
      onReport={onReport}
    />
  );
}

/**
 * A bubble. A message of the other can be reported: a long press on the bubble (touch screens),
 * or its « ⋯ » button, reached with the keyboard and shown on screens with a mouse; both open
 * the same report (9l).
 */
function Bubble({
  mine,
  accent,
  name,
  text,
  time,
  onReport,
}: {
  mine: boolean;
  accent: Accent;
  name: string;
  text: string;
  time: string;
  onReport?: () => void;
}) {
  const t = useTranslations("Relations.parloir");
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const touched = useRef(false);

  const cancel = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  const pressHandlers = onReport
    ? {
        onPointerDown: (event: ReactPointerEvent) => {
          touched.current = event.pointerType !== "mouse";
          if (!touched.current) return;
          cancel();
          press.current = {
            x: event.clientX,
            y: event.clientY,
            timer: window.setTimeout(() => {
              press.current = null;
              onReport();
            }, LONG_PRESS_MS),
          };
        },
        onPointerMove: (event: ReactPointerEvent) => {
          const start = press.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel();
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onPointerLeave: cancel,
        // The long press is ours on a touch screen, not the browser's menu.
        onContextMenu: (event: ReactMouseEvent) => {
          if (touched.current) event.preventDefault();
        },
      }
    : {};

  return (
    <div
      data-accent={accent}
      className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}
    >
      <span className="font-stamp text-accent text-[11px] tracking-[0.15em] uppercase">{name}</span>
      <div className={cn("flex max-w-[85%] items-center gap-1", mine && "flex-row-reverse")}>
        <p
          {...pressHandlers}
          className={cn(
            "border-accent rounded-lg border-2 bg-[#0e0e10]/80 px-3 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap",
            mine ? "rounded-br-sm" : "rounded-bl-sm",
            onReport && "[-webkit-touch-callout:none] pointer-coarse:select-none",
          )}
          data-testid={onReport ? "reportable-message" : undefined}
        >
          {text}
        </p>
        {onReport ? (
          <button
            type="button"
            onClick={onReport}
            aria-label={t("messageActions", { pseudo: name })}
            className="text-grey hover:text-cream flex size-11 shrink-0 items-center justify-center rounded-md pointer-coarse:sr-only pointer-coarse:focus-visible:not-sr-only"
          >
            <Ellipsis aria-hidden="true" className="size-5" />
          </button>
        ) : null}
      </div>
      <span className="text-grey text-[11px] tabular-nums">{time}</span>
    </div>
  );
}
