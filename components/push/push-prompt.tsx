"use client";

import { BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import {
  declinePushPromptAction,
  savePushSubscriptionAction,
} from "@/app/[locale]/(app)/push-actions";
import { Button, buttonClasses } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { currentSubscription, pushSupport, subscribeBrowser } from "@/lib/push/client";

const DECLINE_DAYS = 30;

type Mode = "hidden" | "ask" | "install" | "done";

/**
 * The offer to switch notifications on, shown at the right moment only (SPEC §7 quater): after
 * the first request sent (Visitor) or the first request accepted (Bad), never on arrival.
 * « Plus tard » or a refusal in the browser is respected for 30 days.
 */
export function PushPrompt({ declinedAt }: { declinedAt: string | null }) {
  const t = useTranslations("Push.prompt");
  const [mode, setMode] = useState<Mode>("hidden");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void detectMode(declinedAt).then((found) => {
      if (!cancelled) setMode(found);
    });
    return () => {
      cancelled = true;
    };
  }, [declinedAt]);

  if (mode === "hidden") return null;

  const later = () =>
    startTransition(async () => {
      setMode("hidden");
      await declinePushPromptAction();
    });

  const enable = () =>
    startTransition(async () => {
      try {
        const subscription = await subscribeBrowser();
        if (!subscription) {
          setMode("hidden");
          await declinePushPromptAction();
          return;
        }
        const result = await savePushSubscriptionAction(subscription);
        setMode(result.status === "done" ? "done" : "hidden");
      } catch {
        setMode("hidden");
      }
    });

  return (
    <section
      aria-labelledby="push-prompt-title"
      data-testid="push-prompt"
      className="border-accent/50 bg-ink-2 flex flex-col gap-3 rounded-md border p-4"
    >
      <h2 id="push-prompt-title" className="flex items-center gap-2 font-bold">
        <BellRing aria-hidden="true" className="text-accent size-5" />
        {mode === "done" ? t("doneTitle") : t("title")}
      </h2>
      <p className="text-grey text-sm" role={mode === "done" ? "status" : undefined}>
        {mode === "done" ? t("doneBody") : mode === "install" ? t("installBody") : t("body")}
      </p>
      {mode === "done" ? null : (
        <div className="flex flex-wrap gap-2">
          {mode === "install" ? (
            <Link href="/installer" className={buttonClasses("primary", "md")}>
              {t("installLink")}
            </Link>
          ) : (
            <Button onClick={enable} disabled={pending}>
              {t("enable")}
            </Button>
          )}
          <Button variant="ghost" onClick={later} disabled={pending}>
            {t("later")}
          </Button>
        </div>
      )}
    </section>
  );
}

async function detectMode(declinedAt: string | null): Promise<Mode> {
  const declined =
    declinedAt !== null &&
    Date.now() - new Date(declinedAt).getTime() < DECLINE_DAYS * 24 * 3600 * 1000;
  if (declined) return "hidden";
  const support = pushSupport();
  if (support === "install") return "install";
  if (support !== "ok" || Notification.permission !== "default") return "hidden";
  return (await currentSubscription()) ? "hidden" : "ask";
}
