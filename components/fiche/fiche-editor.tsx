"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { updateFicheAction, type FicheState } from "@/app/[locale]/(app)/ma-fiche/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitWithoutReset } from "@/lib/forms/submit";
import { useToast } from "@/components/ui/toast";
import { VISIT_MOTIVE_MAX, type Role } from "@/lib/onboarding/config";

type Tribe = { id: number; label: string };
/** Bad: présentation (500); Visitor: Motif de visite (280, required), SPEC v7 §5 and §5 bis. */
type Props = {
  role: Role;
  text: string;
  tribes: Tribe[];
  selected: Record<number, string | null>;
};
const IDLE: FicheState = { status: "idle" };

export function FicheEditor({ role, text, tribes, selected }: Props) {
  const t = useTranslations("MyFiche");
  const toast = useToast();
  const [state, action, pending] = useActionState(updateFicheAction, IDLE);
  const [chosen, setChosen] = useState<number[]>(Object.keys(selected).map(Number));

  useEffect(() => {
    if (state.status === "saved") toast.show(t("saved"), "success");
  }, [state, t, toast]);

  function toggle(id: number, on: boolean) {
    setChosen((current) => (on ? [...current, id] : current.filter((value) => value !== id)));
  }

  return (
    <form onSubmit={submitWithoutReset(action)} className="space-y-6">
      {role === "visitor" ? (
        <Textarea
          id="motive"
          name="motive"
          required
          maxLength={VISIT_MOTIVE_MAX}
          defaultValue={text}
          label={t("motive")}
          hint={t("motiveHint", { max: VISIT_MOTIVE_MAX })}
        />
      ) : (
        <Textarea
          id="bio"
          name="bio"
          maxLength={500}
          defaultValue={text}
          label={t("bio")}
          hint={t("bioHint")}
        />
      )}
      <fieldset className="space-y-3" aria-describedby="signs-hint">
        <legend className="text-sm font-semibold">{t("signsTitle")}</legend>
        <p id="signs-hint" className="text-grey text-sm">
          {t("signsHint")}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {tribes.map((tribe) => {
            const isOn = chosen.includes(tribe.id);
            return (
              <div
                key={tribe.id}
                className="border-line has-checked:border-accent rounded-lg border p-3"
              >
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    name="tribe"
                    value={tribe.id}
                    checked={isOn}
                    disabled={!isOn && chosen.length >= 5}
                    onChange={(event) => toggle(tribe.id, event.target.checked)}
                    className="accent-accent size-5"
                  />
                  {tribe.label}
                </label>
                {isOn ? (
                  <input
                    type="text"
                    name={`detail-${tribe.id}`}
                    maxLength={60}
                    defaultValue={selected[tribe.id] ?? ""}
                    aria-label={t("signDetail", { sign: tribe.label })}
                    className="border-line bg-ink-2 text-cream mt-2 min-h-11 w-full rounded-lg border px-3"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t("save")}
      </Button>
      <p role="alert" className="text-red-bright min-h-6 font-medium">
        {state.status === "error" ? t(`errors.${state.message}`) : null}
      </p>
    </form>
  );
}
