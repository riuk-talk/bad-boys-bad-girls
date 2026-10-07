"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { chooseSlotAction, declineSlotsAction } from "@/app/[locale]/(app)/hours-actions";
import type { ActionState } from "@/app/[locale]/(app)/relations-actions";
import { buttonClasses } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { formatSlot } from "@/lib/hours";

const IDLE: ActionState = { status: "idle" };

type Slot = { id: string; starts_at: string; available: boolean };

/**
 * Les Heures de visite, Visitor side (maquette MesDemandes.dc.html): one slot to confirm, or
 * « Aucun ne me va » once per request. Unavailable slots are greyed « plus disponible ».
 */
export function SlotChooser({
  requestId,
  pseudo,
  tz,
  slots,
  canDecline,
}: {
  requestId: string;
  pseudo: string;
  tz: string;
  slots: Slot[];
  canDecline: boolean;
}) {
  const t = useTranslations("Relations.schedule");
  const errorT = useTranslations("Relations.errors");
  const locale = useLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [chooseState, choose, choosing] = useActionState(chooseSlotAction, IDLE);
  const [declineState, decline, declining] = useActionState(declineSlotsAction, IDLE);
  const done = chooseState.status === "done" || declineState.status === "done";

  useEffect(() => {
    if (done) router.refresh();
  }, [done, router]);

  const label = (slot: Slot) => formatSlot(new Date(slot.starts_at), tz, locale);
  const chosen = slots.find((slot) => slot.id === selected);
  const error =
    chooseState.status === "error"
      ? chooseState.message
      : declineState.status === "error"
        ? declineState.message
        : null;

  return (
    <div className="flex flex-col gap-3">
      <form action={choose} className="flex flex-col gap-3">
        <input type="hidden" name="slot" value={selected ?? ""} />
        <div className="flex flex-col gap-2" role="group" aria-label={t("hoursTitle")}>
          {slots.map((slot) => {
            const pressed = slot.id === selected;
            return (
              <button
                key={slot.id}
                type="button"
                disabled={!slot.available || done}
                aria-pressed={pressed}
                onClick={() => setSelected(slot.id)}
                className={cn(
                  "flex min-h-13 w-full items-center justify-between rounded-md border-2 px-3.5 text-left text-[15px] font-semibold",
                  pressed ? "border-accent bg-[#1c1810]" : "border-[#2e2e34] bg-[#0e0e10]",
                  !slot.available && "opacity-50",
                )}
              >
                <span>{label(slot)}</span>
                {!slot.available ? (
                  <span className="text-grey text-xs font-normal">{t("noLonger")}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <button
          type="submit"
          disabled={!chosen || choosing || done}
          className={buttonClasses(
            "primary",
            "lg",
            "font-display w-full rounded-[4px] text-lg uppercase",
          )}
        >
          {chosen ? t("confirm", { slot: label(chosen) }) : t("pickOne")}
        </button>
      </form>
      {canDecline ? (
        <form action={decline} className="flex flex-col items-center gap-1">
          <input type="hidden" name="request" value={requestId} />
          <button
            type="submit"
            disabled={declining || done}
            className="text-cream min-h-11 text-sm underline underline-offset-4"
          >
            {t("noneFits")}
          </button>
          <p className="text-grey text-center text-xs">{t("noneFitsHint", { pseudo })}</p>
        </form>
      ) : null}
      <p role="alert" className="text-red-bright min-h-5 text-sm">
        {error ? errorT(error as "generic") : null}
      </p>
    </div>
  );
}
