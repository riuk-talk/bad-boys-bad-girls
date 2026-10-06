"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState, useTransition } from "react";
import {
  pushPreferencesAction,
  revokePushSubscriptionAction,
  savePushSubscriptionAction,
} from "@/app/[locale]/(app)/push-actions";
import type { ActionState } from "@/app/[locale]/(app)/relations-actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  currentSubscription,
  pushSupport,
  subscribeBrowser,
  unsubscribeBrowser,
  type PushSupport,
} from "@/lib/push/client";

const IDLE: ActionState = { status: "idle" };

type Preferences = { requests: boolean; promenade: boolean; visits: boolean };
type Device = "loading" | "on" | "off" | "blocked" | PushSupport;

/** Ma Fiche · Notifications: this browser on or off, how many browsers, which kinds. */
export function PushSettings({
  devices,
  preferences,
}: {
  devices: number;
  preferences: Preferences;
}) {
  const t = useTranslations("Push.settings");
  const [device, setDevice] = useState<Device>("loading");
  const [failed, setFailed] = useState(false);
  const [busy, startTransition] = useTransition();
  const [state, action, saving] = useActionState(pushPreferencesAction, IDLE);

  useEffect(() => {
    let cancelled = false;
    void detectDevice().then((found) => {
      if (!cancelled) setDevice(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const switchOn = () =>
    startTransition(async () => {
      setFailed(false);
      try {
        const subscription = await subscribeBrowser();
        if (!subscription) {
          setDevice(Notification.permission === "denied" ? "blocked" : "off");
          return;
        }
        const result = await savePushSubscriptionAction(subscription);
        if (result.status === "done") setDevice("on");
        else setFailed(true);
      } catch {
        setFailed(true);
      }
    });

  const switchOff = () =>
    startTransition(async () => {
      setFailed(false);
      try {
        const endpoint = await unsubscribeBrowser();
        if (endpoint) await revokePushSubscriptionAction(endpoint);
        setDevice("off");
      } catch {
        setFailed(true);
      }
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="border-line bg-ink-2 flex flex-col gap-3 rounded-md border p-4">
        <p className="font-semibold">{t("deviceTitle")}</p>
        <p className="text-grey text-sm" role="status">
          {device === "loading" ? " " : t(`device_${device}`)}
        </p>
        {device === "on" ? (
          <Button variant="secondary" onClick={switchOff} disabled={busy} className="self-start">
            {t("switchOff")}
          </Button>
        ) : device === "off" ? (
          <Button onClick={switchOn} disabled={busy} className="self-start">
            {t("switchOn")}
          </Button>
        ) : device === "install" ? (
          <Link href="/installer" className={buttonClasses("primary", "md", "self-start")}>
            {t("installLink")}
          </Link>
        ) : null}
        {failed ? <p className="text-red-bright text-sm">{t("error")}</p> : null}
        <p className="text-grey text-xs">{t("devices", { count: devices })}</p>
      </div>

      <form action={action} className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-semibold">{t("kindsTitle")}</legend>
          {(["requests", "promenade", "visits"] as const).map((kind) => (
            <label key={kind} className="flex min-h-11 cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                name={kind}
                value="1"
                defaultChecked={preferences[kind]}
                className="accent-accent mt-0.5 size-6 shrink-0"
              />
              <span>
                <span className="block font-semibold">{t(`kind_${kind}`)}</span>
                <span className="text-grey text-xs">{t(`kindHint_${kind}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          disabled={saving}
          className={buttonClasses("secondary", "md", "self-start")}
        >
          {t("save")}
        </button>
        <p role="status" className="text-grey min-h-5 text-sm">
          {state.status === "done" ? t("saved") : state.status === "error" ? t("error") : null}
        </p>
      </form>
      <p className="text-grey text-xs">{t("neutral")}</p>
    </div>
  );
}

async function detectDevice(): Promise<Device> {
  const support = pushSupport();
  if (support !== "ok") return support;
  if (Notification.permission === "denied") return "blocked";
  return (await currentSubscription()) ? "on" : "off";
}
