"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useActionState, useId, type ReactNode } from "react";
import {
  changeGenderAction,
  changePlaceAction,
  changePseudoAction,
  requestCorrectionAction,
  type IdentityState,
} from "@/app/[locale]/(app)/ma-fiche/identite/actions";
import { CityPicker } from "@/components/onboarding/city-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { REASON_MAX } from "@/lib/validation/identity";
import { Constants, type Database } from "@/lib/supabase/database.types";

type Gender = Database["public"]["Enums"]["gender"];
const IDLE: IdentityState = { status: "idle" };

function Outcome({ state, doneKey }: { state: IdentityState; doneKey: string }) {
  const t = useTranslations("MyFiche.identity");
  const format = useFormatter();
  if (state.status === "done") {
    return (
      <p role="status" className="text-accent text-sm font-semibold">
        {t(doneKey)}
      </p>
    );
  }
  return (
    <p role="alert" className="text-red-bright min-h-0 text-sm font-medium empty:hidden">
      {state.status === "error"
        ? t(`errors.${state.error}`, {
            date: state.until ? format.dateTime(new Date(state.until), { dateStyle: "long" }) : "",
          })
        : null}
    </p>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="border-line space-y-3 rounded-[var(--radius-card)] border p-4"
    >
      <h2 id={id} className="font-display text-2xl tracking-wide uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Pseudo: once every 30 days after the onboarding (SQL), the rules of the sign-up. */
export function PseudoForm({ pseudo, nextChange }: { pseudo: string; nextChange: string | null }) {
  const t = useTranslations("MyFiche.identity");
  const format = useFormatter();
  const id = useId();
  const [state, action, pending] = useActionState(changePseudoAction, IDLE);
  return (
    <Section id={`${id}-title`} title={t("pseudoTitle")}>
      <form action={action} className="space-y-3">
        <Input
          id={`${id}-pseudo`}
          name="pseudo"
          label={t("pseudo")}
          hint={
            nextChange
              ? t("pseudoNext", {
                  date: format.dateTime(new Date(nextChange), { dateStyle: "long" }),
                })
              : t("pseudoHint")
          }
          defaultValue={pseudo}
          minLength={3}
          maxLength={20}
          required
        />
        <Button type="submit" disabled={pending || Boolean(nextChange)} aria-busy={pending}>
          {t("save")}
        </Button>
        <Outcome state={state} doneKey="pseudoDone" />
      </form>
    </Section>
  );
}

/** Gender: the colour of the interface follows; the criteria of the others apply to the new one. */
export function GenderForm({ gender }: { gender: Gender | null }) {
  const t = useTranslations("MyFiche.identity");
  const genders = useTranslations("Onboarding.identity.genders");
  const id = useId();
  const [state, action, pending] = useActionState(changeGenderAction, IDLE);
  return (
    <Section id={`${id}-title`} title={t("genderTitle")}>
      <form action={action} className="space-y-3">
        <fieldset className="space-y-2">
          <legend className="text-cream/85 text-sm">{t("genderHint")}</legend>
          <div className="grid grid-cols-2 gap-2">
            {Constants.public.Enums.gender.map((value) => (
              <label
                key={value}
                className="border-line has-checked:border-accent has-checked:bg-accent/10 has-focus-visible:outline-accent flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3.5 has-focus-visible:outline-3"
              >
                <input
                  type="radio"
                  name="gender"
                  value={value}
                  defaultChecked={gender === value}
                  className="accent-accent size-5"
                />
                {genders(value)}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {t("save")}
        </Button>
        <Outcome state={state} doneKey="genderDone" />
      </form>
    </Section>
  );
}

/** Town: the quartier is computed again; a closed one is said before saving. */
export function PlaceForm({ place }: { place: { id: number; label: string } | null }) {
  const t = useTranslations("MyFiche.identity");
  const id = useId();
  const [state, action, pending] = useActionState(changePlaceAction, IDLE);
  return (
    <Section id={`${id}-title`} title={t("placeTitle")}>
      <form action={action} className="space-y-3">
        <CityPicker initial={place} />
        {state.status === "confirm" ? (
          <div
            role="alert"
            className="border-accent/60 bg-accent/5 space-y-3 rounded-lg border p-3"
          >
            <p className="text-sm">
              {state.zone ? t("zoneClosed", { zone: state.zone }) : t("zoneNone")}
            </p>
            <Button type="submit" name="confirm" value="1" disabled={pending} aria-busy={pending}>
              {t("saveAnyway")}
            </Button>
          </div>
        ) : (
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {t("save")}
          </Button>
        )}
        <Outcome state={state} doneKey="placeDone" />
      </form>
    </Section>
  );
}

export type CorrectionView = {
  status: "pending" | "accepted" | "refused";
  requested: string;
  createdAt: string;
  decisionReason: string | null;
};

/**
 * Date of birth: never changed by the member once the dossier is finished; a request to the
 * Greffe with a short motive, one at a time (SQL).
 */
export function BirthdateSection({
  birthdate,
  corrections,
}: {
  birthdate: string;
  corrections: CorrectionView[];
}) {
  const t = useTranslations("MyFiche.identity");
  const format = useFormatter();
  const id = useId();
  const [state, action, pending] = useActionState(requestCorrectionAction, IDLE);
  const waiting = corrections.some((c) => c.status === "pending") || state.status === "done";
  // A date without time: noon UTC, the same day in every time zone of the members.
  const day = (value: string) =>
    format.dateTime(new Date(`${value.slice(0, 10)}T12:00:00Z`), { dateStyle: "long" });
  return (
    <Section id={`${id}-title`} title={t("birthdateTitle")}>
      <p>
        {t("birthdateValue", { date: day(birthdate) })}{" "}
        <span className="text-grey text-sm">{t("birthdateLocked")}</span>
      </p>
      {corrections.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {corrections.map((c) => (
            <li key={c.createdAt}>
              {t(`correction.${c.status}`, { date: day(c.requested) })}
              {c.decisionReason ? ` ${t("correction.motive", { reason: c.decisionReason })}` : null}
            </li>
          ))}
        </ul>
      ) : null}
      {waiting ? (
        <p role="status" className="text-accent text-sm font-semibold">
          {t("correctionWaiting")}
        </p>
      ) : (
        <details className="group">
          <summary className="text-accent inline-flex min-h-11 cursor-pointer items-center font-semibold underline underline-offset-4">
            {t("askCorrection")}
          </summary>
          <form action={action} className="mt-3 space-y-3">
            <Input
              id={`${id}-birthdate`}
              name="birthdate"
              type="date"
              label={t("rightBirthdate")}
              required
            />
            <Textarea
              id={`${id}-reason`}
              name="reason"
              label={t("reason")}
              hint={t("reasonHint", { max: REASON_MAX })}
              maxLength={REASON_MAX}
              required
            />
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {t("sendCorrection")}
            </Button>
            <Outcome state={state} doneKey="correctionDone" />
          </form>
        </details>
      )}
    </Section>
  );
}
