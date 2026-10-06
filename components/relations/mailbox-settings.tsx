"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { mailboxSettingsAction, type ActionState } from "@/app/[locale]/(app)/relations-actions";
import { buttonClasses } from "@/components/ui/button";

const IDLE: ActionState = { status: "idle" };
const CAPS = [5, 10, 15, 20, 25, 30, 40, 50];

/** The Bad's cap of pending requests and the manual « Parloir complet » (SPEC §7). */
export function MailboxSettings({ cap, closed }: { cap: number; closed: boolean }) {
  const t = useTranslations("Relations.mailbox");
  const [state, action, pending] = useActionState(mailboxSettingsAction, IDLE);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="cap" className="text-sm font-semibold">
        {t("capLabel")}
      </label>
      <select
        id="cap"
        name="cap"
        defaultValue={String(cap)}
        className="border-line bg-ink focus:border-accent min-h-11 rounded-md border px-3 focus:outline-none"
        aria-describedby="cap-hint"
      >
        {(CAPS.includes(cap) ? CAPS : [...CAPS, cap].sort((a, b) => a - b)).map((value) => (
          <option key={value} value={value}>
            {t("capValue", { count: value })}
          </option>
        ))}
      </select>
      <p id="cap-hint" className="text-grey -mt-1 text-xs">
        {t("capHint")}
      </p>
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          name="closed"
          value="1"
          defaultChecked={closed}
          className="accent-accent mt-0.5 size-6 shrink-0"
        />
        <span>
          <span className="block font-semibold">{t("closeLabel")}</span>
          <span className="text-grey text-xs">{t("closeHint")}</span>
        </span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className={buttonClasses("secondary", "md", "self-start")}
      >
        {t("save")}
      </button>
      <p role="status" className="text-grey min-h-5 text-sm">
        {state.status === "done" ? t("saved") : state.status === "error" ? t("saveError") : null}
      </p>
    </form>
  );
}
