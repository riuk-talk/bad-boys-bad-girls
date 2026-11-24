"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import {
  changeRoleAction,
  pauseAction,
  unblockAction,
  type ActionState,
} from "@/app/[locale]/(app)/relations-actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Link } from "@/i18n/navigation";
import type { Role } from "@/lib/onboarding/config";
import { SITE_TIME_ZONE } from "@/lib/time-zone";

const IDLE: ActionState = { status: "idle" };

type Props = {
  role: Role;
  paused: boolean;
  /** Earliest date of the next role change (7 days after the last), ISO, or null. */
  nextRoleChange: string | null;
  hasMotive: boolean;
  blocked: { id: string; pseudo: string }[];
  locale: string;
};

/**
 * Ma Fiche · the account (SPEC §2 bis, §10): pause the Fiche (Bad), change role once per
 * 7 days, unblock someone. Every rule is in SQL; this only explains the effects first.
 */
export function AccountSettings({
  role,
  paused,
  nextRoleChange,
  hasMotive,
  blocked,
  locale,
}: Props) {
  const t = useTranslations("Relations.account");
  const errorT = useTranslations("Relations.errors");
  const [pauseState, pause, pausing] = useActionState(pauseAction, IDLE);
  const [roleState, changeRole, changing] = useActionState(changeRoleAction, IDLE);
  const [, unblock, unblocking] = useActionState(unblockAction, IDLE);
  const [confirmRole, setConfirmRole] = useState(false);
  const target: Role = role === "bad" ? "visitor" : "bad";
  const tooSoon = nextRoleChange !== null && new Date(nextRoleChange) > new Date();
  const until = nextRoleChange
    ? new Intl.DateTimeFormat(locale, {
        timeZone: SITE_TIME_ZONE,
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(nextRoleChange))
    : "";

  return (
    <div className="flex flex-col gap-6">
      {role === "bad" ? (
        <section aria-labelledby="pause-title" className="flex flex-col gap-2">
          <h3 id="pause-title" className="font-semibold">
            {t("pauseTitle")}
          </h3>
          <p className="text-grey text-sm">{paused ? t("pausedBody") : t("pauseBody")}</p>
          <form action={pause}>
            <input type="hidden" name="paused" value={paused ? "0" : "1"} />
            <button type="submit" disabled={pausing} className={buttonClasses("secondary", "md")}>
              {paused ? t("resume") : t("pause")}
            </button>
          </form>
          {pauseState.status === "error" ? (
            <p role="alert" className="text-red-bright text-sm">
              {errorT("generic")}
            </p>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="role-title" className="flex flex-col gap-2">
        <h3 id="role-title" className="font-semibold">
          {t("roleTitle")}
        </h3>
        <p className="text-grey text-sm">{t(`roleBody_${target}`)}</p>
        {tooSoon ? (
          <p className="text-cream/90 text-sm">{t("roleTooSoon", { date: until })}</p>
        ) : target === "visitor" && !hasMotive ? (
          <p className="text-cream/90 text-sm">{t("roleNeedsMotive")}</p>
        ) : (
          <Button variant="secondary" className="self-start" onClick={() => setConfirmRole(true)}>
            {t(`become_${target}`)}
          </Button>
        )}
        <Modal
          open={confirmRole}
          onClose={() => setConfirmRole(false)}
          title={t(`become_${target}`)}
        >
          {roleState.status === "done" ? (
            <div className="flex flex-col gap-4">
              <p role="status">{t(`roleDone_${target}`)}</p>
              <Link
                href={target === "bad" ? "/ma-fiche" : "/promenade"}
                className={buttonClasses("primary", "md")}
              >
                {t("continue")}
              </Link>
            </div>
          ) : (
            <form action={changeRole} className="flex flex-col gap-4">
              <input type="hidden" name="role" value={target} />
              <ul className="text-cream/90 list-disc space-y-1 pl-5 text-sm">
                {(t.raw(`roleEffects_${target}`) as string[]).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={changing}
                  className={buttonClasses("primary", "md")}
                >
                  {t("confirmRole")}
                </button>
                <Button variant="ghost" onClick={() => setConfirmRole(false)}>
                  {t("cancel")}
                </Button>
              </div>
              <p role="alert" className="text-red-bright min-h-5 text-sm">
                {roleState.status === "error" ? errorT(roleState.message as "generic") : null}
              </p>
            </form>
          )}
        </Modal>
      </section>

      <section aria-labelledby="blocked-title" className="flex flex-col gap-2">
        <h3 id="blocked-title" className="font-semibold">
          {t("blockedTitle")}
        </h3>
        {blocked.length === 0 ? (
          <p className="text-grey text-sm">{t("blockedEmpty")}</p>
        ) : (
          <ul className="flex flex-col">
            {blocked.map((member) => (
              <li
                key={member.id}
                className="border-line flex min-h-12 items-center justify-between gap-3 border-t"
              >
                <span>{member.pseudo}</span>
                <form action={unblock}>
                  <input type="hidden" name="target" value={member.id} />
                  <button
                    type="submit"
                    disabled={unblocking}
                    className={buttonClasses("ghost", "inline")}
                  >
                    {t("unblock")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
