"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { Check, Flag, ImagePlus, SendHorizontal, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  decideProposalAction,
  depositPoseAction,
  loadGreffeAction,
  markGreffeReadAction,
  sendGreffeAction,
} from "@/app/[locale]/(app)/greffe-mail-actions";
import { ReportDialog } from "@/components/relations/report-dialog";
import { cn } from "@/lib/cn";
import {
  BODY_MAX,
  DEPOSIT_CHOICES,
  FILE_TYPES,
  checkFiles,
  mergeGreffe,
  newestOf,
  readMark,
  type DepositChoice,
  type GreffeMessage,
  type Side,
} from "@/lib/greffe-mail";
import { TYPING_SHOWN_MS, dayKey, dayLabel, timeLabel, typingDue } from "@/lib/parloir-thread";
import { createClient } from "@/lib/supabase/browser";

/** Without a realtime connection the thread is read every 3 s; with one, a safety read every 15 s. */
const FALLBACK_POLL_MS = 3000;
const SAFETY_POLL_MS = 15000;
/** An image is compressed in the browser to this weight at most (the server re-encodes it). */
const COMPRESSED_BYTES = 450_000;

type Props = {
  threadId: string;
  side: Side;
  initial: GreffeMessage[];
  memberReadId: number;
  teamReadId: number;
  /** The member answers only an open thread; the team writes to a reachable member. */
  canWrite: boolean;
  /** The team may mark a message as a moderation decision (for a suspended or banned member). */
  canModerate?: boolean;
  /** Who « écrit… » on the other side: the member's pseudo for the team, « Le Greffe » otherwise. */
  otherName: string;
  /** The member's role: a Visitor deposits only the face photo. */
  memberRole?: "bad" | "visitor" | null;
  tz: string;
};

async function compress(files: File[]): Promise<Blob[]> {
  const { compressForUpload } = await import("@/lib/image/compress");
  return Promise.all(files.map((file) => compressForUpload(file, { maxBytes: COMPRESSED_BYTES })));
}

/**
 * The Messagerie du Greffe (10g), one thread: the team (Messagerie) and the member (Courrier du
 * Greffe). New messages come by Supabase Realtime (RLS: the member and the team; joined with the
 * user's token, live only once the database confirms it), read again by greffe_messages_since;
 * « … écrit » on a private Broadcast channel; « Lu » under the last message the other side read.
 */
export function GreffeThread({
  threadId,
  side,
  initial,
  memberReadId,
  teamReadId,
  canWrite,
  canModerate = false,
  otherName,
  memberRole = null,
  tz,
}: Props) {
  const t = useTranslations("GreffeMail");
  const locale = useLocale();
  const [messages, setMessages] = useState(initial);
  const [reads, setReads] = useState({ member: memberReadId, team: teamReadId });
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [moderation, setModeration] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [othersTyping, setOthersTyping] = useState(false);
  const [reporting, setReporting] = useState<number | null>(null);
  const [deposit, setDeposit] = useState<DepositChoice>("show");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const lastId = useRef(initial.at(-1)?.id ?? 0);
  const markedId = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingChannel = useRef<RealtimeChannel | null>(null);
  const typingSent = useRef(0);
  const typingTimer = useRef<number | undefined>(undefined);
  const other: Side = side === "team" ? "member" : "team";

  const refresh = useCallback(async () => {
    const update = await loadGreffeAction(threadId, lastId.current).catch(() => null);
    if (!update) return;
    setReads({ member: update.member_read_id, team: update.team_read_id });
    if (update.messages.length === 0) return;
    if (update.messages.some((message) => message.side !== side)) setOthersTyping(false);
    setMessages((current) => {
      const merged = mergeGreffe(current, update.messages);
      lastId.current = merged.at(-1)?.id ?? lastId.current;
      return merged;
    });
  }, [threadId, side]);

  // New messages and read receipts (postgres_changes), joined with the user's own token.
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
      await supabase.realtime.setAuth().catch(() => undefined);
      if (cancelled) return;
      try {
        channel = supabase
          .channel(`greffe:${threadId}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "greffe_messages",
              filter: `thread_id=eq.${threadId}`,
            },
            () => read(),
          )
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "greffe_threads",
              filter: `id=eq.${threadId}`,
            },
            () => read(),
          )
          // Live only once the database confirms the subscription (the Parloir's lesson, 10f).
          .on("system", {}, (payload: { extension?: string; status?: string }) => {
            if (payload.extension !== "postgres_changes") return;
            const wasLive = live;
            live = payload.status === "ok";
            if (live && !wasLive) read();
          })
          .subscribe((status) => {
            if (status !== "SUBSCRIBED") live = false;
          });
      } catch {
        // No WebSocket: the 3 s poll carries the thread.
      }
    })();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRead >= (live ? SAFETY_POLL_MS : FALLBACK_POLL_MS)) read();
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
  }, [threadId, refresh]);

  // « … écrit »: a private Broadcast channel of the thread (the member and the team only).
  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    try {
      channel = supabase.channel(`greffe-typing:${threadId}`, {
        config: { private: true, broadcast: { self: false } },
      });
      channel.on("broadcast", { event: "typing" }, ({ payload }) => {
        const signal = payload as { stop?: boolean; side?: Side } | undefined;
        if (signal?.side === side) return;
        window.clearTimeout(typingTimer.current);
        if (signal?.stop) {
          setOthersTyping(false);
          return;
        }
        setOthersTyping(true);
        typingTimer.current = window.setTimeout(() => setOthersTyping(false), TYPING_SHOWN_MS);
      });
      const joining = channel;
      void supabase.realtime
        .setAuth()
        .then(() => joining.subscribe())
        .catch(() => undefined);
      typingChannel.current = channel;
    } catch {
      // No WebSocket: no « … écrit ».
    }
    return () => {
      window.clearTimeout(typingTimer.current);
      typingChannel.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [threadId, side]);

  const signalTyping = useCallback(
    (stop: boolean) => {
      const channel = typingChannel.current;
      if (!channel) return;
      if (stop) {
        if (typingSent.current === 0) return;
        typingSent.current = 0;
        void channel.send({ type: "broadcast", event: "typing", payload: { stop: true, side } });
        return;
      }
      const at = Date.now();
      if (!typingDue(typingSent.current, at)) return;
      typingSent.current = at;
      void channel.send({ type: "broadcast", event: "typing", payload: { side } });
    },
    [side],
  );

  // What is on screen is read: up to the newest message of the other side.
  const newest = newestOf(messages, other);
  useEffect(() => {
    const mark = () => {
      if (document.visibilityState !== "visible" || newest <= markedId.current) return;
      markedId.current = newest;
      void markGreffeReadAction(threadId, newest).catch(() => {
        markedId.current = 0;
      });
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [threadId, newest]);

  // The list follows the newest message.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  const pick = (chosen: FileList | null) => {
    const list = chosen ? Array.from(chosen) : [];
    const problem = checkFiles(deposit === "show" ? [...files, ...list] : list);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setFiles(deposit === "show" ? [...files, ...list] : list.slice(0, 1));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const body = draft.trim();
    if (body === "" && files.length === 0) return;
    setSending(true);
    setError(null);
    try {
      let blobs: Blob[] = [];
      try {
        blobs = await compress(files);
      } catch {
        setError("unreadable");
        return;
      }
      // A pose deposited at the Greffe (member): its own upload, then the text, if any.
      if (side === "member" && deposit !== "show" && blobs.length === 1) {
        const form = new FormData();
        form.set("pose", deposit);
        form.set("photo", new File([blobs[0]!], "photo.webp", { type: blobs[0]!.type }));
        const result = await depositPoseAction(form).catch(() => null);
        if (!result?.ok) {
          setError(result && !result.ok ? result.error : "generic");
          return;
        }
        blobs = [];
      }
      if (body !== "" || blobs.length > 0) {
        const form = new FormData();
        form.set("thread", threadId);
        form.set("body", body);
        if (moderation) form.set("moderation", "1");
        blobs.forEach((blob, index) =>
          form.append("files", new File([blob], `image-${index}.webp`, { type: blob.type })),
        );
        const result = await sendGreffeAction(form).catch(() => null);
        if (!result?.ok) {
          setError(result && !result.ok ? result.error : "generic");
          return;
        }
      }
      setDraft("");
      setFiles([]);
      setModeration(false);
      setDeposit("show");
      if (fileRef.current) fileRef.current.value = "";
      signalTyping(true);
      await refresh();
    } finally {
      setSending(false);
    }
  };

  const decide = async (proposalId: string, accept: boolean) => {
    setDeciding(proposalId);
    setError(null);
    const result = await decideProposalAction(proposalId, accept).catch(() => null);
    setDeciding(null);
    if (!result?.ok) setError(result && !result.ok ? result.error : "generic");
    await refresh();
  };

  const mark = readMark(messages, side, side === "team" ? reads.member : reads.team);
  const dayText = (iso: string) => {
    const label = dayLabel(iso, now, tz, locale);
    return label.kind === "date" ? label.text : t(label.kind);
  };
  const poses = memberRole === "visitor" ? (["0", "show"] as const) : DEPOSIT_CHOICES;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <ol
        ref={listRef}
        aria-label={t("thread")}
        aria-live="polite"
        tabIndex={0}
        className="focus-visible:outline-accent flex max-h-[calc(100dvh-24rem)] min-h-48 flex-col gap-3 overflow-y-auto rounded-md border border-[#2a2a2e] bg-[#141416] p-3 focus-visible:outline-2"
      >
        {messages.length === 0 ? <li className="text-grey text-sm">{t("empty")}</li> : null}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const newDay =
            !previous || dayKey(previous.created_at, tz) !== dayKey(message.created_at, tz);
          const mine = message.side === side;
          return (
            <Fragment key={message.id}>
              {newDay ? (
                <li className="text-grey text-center text-[12px] tracking-[0.12em] uppercase">
                  {dayText(message.created_at)}
                </li>
              ) : null}
              <li
                data-message-id={message.id}
                className={cn("flex flex-col", mine ? "items-end" : "items-start")}
              >
                <MessageView
                  message={message}
                  mine={mine}
                  side={side}
                  time={timeLabel(message.created_at, tz)}
                  deciding={deciding}
                  onDecide={decide}
                />
                {side === "member" && message.side === "team" && message.kind === "text" ? (
                  <button
                    type="button"
                    onClick={() => setReporting(message.id)}
                    className="text-grey hover:text-cream inline-flex min-h-11 items-center gap-1 text-[12px] underline underline-offset-4"
                  >
                    <Flag aria-hidden="true" className="size-3.5" />
                    {t("report")}
                  </button>
                ) : null}
                {message.id === mark ? (
                  <p className="text-grey mt-0.5 text-[11px]" data-testid="greffe-read">
                    {t("read")}
                  </p>
                ) : null}
              </li>
            </Fragment>
          );
        })}
      </ol>
      <p
        aria-live="polite"
        className="text-grey min-h-5 text-[13px] italic"
        data-testid="greffe-typing"
      >
        {othersTyping ? t("typing", { name: otherName }) : null}
      </p>
      {canWrite ? (
        <form onSubmit={submit} className="flex flex-col gap-2" aria-label={t("composer")}>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">{t("messageLabel")}</span>
            <textarea
              name="body"
              rows={3}
              maxLength={BODY_MAX}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                signalTyping(event.target.value.trim() === "");
              }}
              className="border-line bg-ink focus:border-accent w-full resize-y rounded-md border p-2.5 text-[15px] focus:outline-none"
            />
          </label>
          <p className="text-grey text-right text-xs">
            {t("count", { count: draft.length, max: BODY_MAX })}
          </p>
          {side === "member" ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">{t("photoFor")}</span>
              <select
                value={deposit}
                onChange={(event) => {
                  setDeposit(event.target.value as DepositChoice);
                  setFiles([]);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="border-line bg-ink-2 min-h-11 rounded-lg border px-3"
              >
                {poses.map((choice) => (
                  <option key={choice} value={choice}>
                    {t(`deposit.${choice}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label className="border-line hover:bg-ink-2 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-semibold">
              <ImagePlus aria-hidden="true" className="size-4" />
              {deposit === "show" ? t("addImages") : t("choosePhoto")}
              <input
                ref={fileRef}
                type="file"
                accept={[...FILE_TYPES, ".heic", ".heif"].join(",")}
                multiple={deposit === "show"}
                className="sr-only"
                onChange={(event) => pick(event.target.files)}
                data-testid="greffe-files"
              />
            </label>
            {files.length > 0 ? (
              <span className="text-grey text-sm">
                {t("chosen", { count: files.length })}
                <button
                  type="button"
                  onClick={() => {
                    setFiles([]);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  className="text-cream ml-2 inline-flex min-h-11 items-center underline underline-offset-4"
                >
                  {t("clearImages")}
                </button>
              </span>
            ) : null}
          </div>
          <p className="text-grey text-xs">{t("imagesHint")}</p>
          {canModerate ? (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={moderation}
                onChange={(event) => setModeration(event.target.checked)}
                className="accent-accent size-5"
              />
              {t("moderation")}
            </label>
          ) : null}
          <button
            type="submit"
            disabled={sending || (draft.trim() === "" && files.length === 0)}
            className="bg-accent text-ink inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 font-semibold disabled:opacity-50"
          >
            <SendHorizontal aria-hidden="true" className="size-5" />
            {sending ? t("sending") : t("send")}
          </button>
        </form>
      ) : null}
      <p role="alert" className="text-red-bright min-h-5 text-sm">
        {error ? t(`errors.${error}` as "errors.generic") : null}
      </p>
      {reporting !== null ? (
        <ReportDialog
          key={reporting}
          open
          onClose={() => setReporting(null)}
          pseudo={t("greffe")}
          reportType="greffe_message"
          reportTarget={String(reporting)}
        />
      ) : null}
    </div>
  );
}

function MessageView({
  message,
  mine,
  side,
  time,
  deciding,
  onDecide,
}: {
  message: GreffeMessage;
  mine: boolean;
  side: Side;
  time: string;
  deciding: string | null;
  onDecide: (proposalId: string, accept: boolean) => void;
}) {
  const t = useTranslations("GreffeMail");
  const author =
    message.side === "team"
      ? (message.label ?? t("greffe"))
      : side === "member"
        ? t("me")
        : t("member");
  const event =
    message.kind === "photo_deposit"
      ? t("event.deposit", { pose: t(`deposit.${String(message.pose ?? 0) as "0"}`) })
      : message.kind === "photo_accepted"
        ? t("event.accepted")
        : message.kind === "photo_refused"
          ? t("event.refused")
          : null;
  const proposal = message.proposal;
  return (
    <div
      className={cn(
        "flex max-w-[85%] flex-col gap-1 rounded-lg border px-3 py-2",
        mine ? "border-accent bg-ink" : "border-line bg-ink-2",
        message.is_moderation && "border-red-bright",
      )}
    >
      <p className="text-[12px] font-bold tracking-wide">
        {author}
        {message.is_moderation ? (
          <span className="text-red-bright"> · {t("moderationTag")}</span>
        ) : null}
      </p>
      {event ? <p className="text-sm italic">{event}</p> : null}
      {message.body ? (
        <p className="text-[15px] break-words whitespace-pre-wrap">{message.body}</p>
      ) : null}
      {message.attachments.length > 0 ? (
        <div className="grid grid-cols-2 gap-1">
          {message.attachments.map((file, index) =>
            file.url ? (
              <a key={file.id} href={file.url} target="_blank" rel="noreferrer noopener">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                <img
                  src={file.url}
                  alt={t("imageAlt", { n: index + 1 })}
                  width={file.width}
                  height={file.height}
                  className="h-auto w-full rounded"
                  data-testid="greffe-image"
                />
              </a>
            ) : null,
          )}
        </div>
      ) : null}
      {message.attachments_removed > 0 ? (
        <p className="text-grey text-xs">
          {t("imagesRemoved", { count: message.attachments_removed })}
        </p>
      ) : null}
      {proposal ? (
        <div className="flex flex-col gap-2" data-testid="greffe-proposal">
          <p className="text-sm font-semibold">
            {t("proposal.title", { pose: t(`deposit.${String(proposal.position) as "0"}`) })}
          </p>
          {proposal.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img
              src={proposal.url}
              alt={t("proposal.alt")}
              width={proposal.width}
              height={proposal.height}
              className="mugshot-wall h-auto w-40 rounded"
            />
          ) : null}
          <p className="text-grey text-xs">{t(`proposal.status.${proposal.status}`)}</p>
          {side === "member" &&
          (proposal.status === "proposed" || proposal.status === "accepted") ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={deciding === proposal.id}
                onClick={() => onDecide(proposal.id, true)}
                className="bg-accent text-ink inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm font-semibold disabled:opacity-50"
              >
                <Check aria-hidden="true" className="size-4" />
                {proposal.status === "accepted" ? t("proposal.finish") : t("proposal.accept")}
              </button>
              {proposal.status === "proposed" ? (
                <button
                  type="button"
                  disabled={deciding === proposal.id}
                  onClick={() => onDecide(proposal.id, false)}
                  className="border-line inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm font-semibold disabled:opacity-50"
                >
                  <X aria-hidden="true" className="size-4" />
                  {t("proposal.refuse")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="text-grey text-right text-[11px]">{time}</p>
    </div>
  );
}
