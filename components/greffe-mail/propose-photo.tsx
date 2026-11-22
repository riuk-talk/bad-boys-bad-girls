"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import {
  proposePhotoAction,
  type ProposeState,
} from "@/app/[locale]/(app)/admin/messagerie/actions";
import { useRouter } from "@/i18n/navigation";

/**
 * « Proposer une photo retouchée » (10g): the team chooses the pose and the file; the browser
 * compresses it (its transparency kept), the server re-encodes and stores it privately; the member
 * then sees it with « Accepter » / « Refuser ». Nothing replaces a pose before that click.
 */
export function ProposePhoto({ threadId, visitor }: { threadId: string; visitor: boolean }) {
  const t = useTranslations("GreffeMail");
  const router = useRouter();
  const [state, setState] = useState<ProposeState>({ status: "idle" });
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("photo");
    if (!(file instanceof File) || file.size === 0) {
      setState({ status: "error", message: "photoRequired" });
      return;
    }
    setPending(true);
    try {
      const { compressForUpload } = await import("@/lib/image/compress");
      const blob = await compressForUpload(file).catch(() => null);
      if (!blob) {
        setState({ status: "error", message: "unreadable" });
        return;
      }
      form.set("photo", new File([blob], "proposal.webp", { type: blob.type }));
      const result = await proposePhotoAction({ status: "idle" }, form);
      setState(result);
      if (result.status === "done") {
        formRef.current?.reset();
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="flex flex-col gap-3"
      aria-label={t("propose.title")}
    >
      <input type="hidden" name="thread" value={threadId} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">{t("propose.pose")}</span>
        <select name="position" className="border-line bg-ink-2 min-h-11 rounded-lg border px-3">
          {(visitor ? ["0"] : ["0", "1", "2"]).map((pose) => (
            <option key={pose} value={pose}>
              {t(`deposit.${pose as "0"}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">{t("propose.file")}</span>
        <input
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/webp"
          required
          className="text-sm"
          data-testid="propose-file"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">{t("propose.note")}</span>
        <textarea
          name="body"
          rows={2}
          maxLength={2000}
          className="border-line bg-ink w-full rounded-md border p-2.5"
        />
      </label>
      <p className="text-grey text-xs">{t("propose.hint")}</p>
      <button
        type="submit"
        disabled={pending}
        className="border-accent text-cream inline-flex min-h-11 items-center justify-center rounded-md border px-4 font-semibold disabled:opacity-50"
      >
        {pending ? t("sending") : t("propose.submit")}
      </button>
      <p role={state.status === "error" ? "alert" : "status"} className="min-h-5 text-sm">
        {state.status === "error"
          ? t(`errors.${state.message}` as "errors.generic")
          : state.status === "done"
            ? t("propose.done")
            : null}
      </p>
    </form>
  );
}
