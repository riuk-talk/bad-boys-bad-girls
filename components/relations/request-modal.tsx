"use client";

import { Lock, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";
import { sendVisitRequestAction, type ActionState } from "@/app/[locale]/(app)/relations-actions";
import { Stamp } from "@/components/brand/stamp";
import { buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import {
  type Hook,
  type PrompterInput,
  type PrompterTemplates,
  SLOTS,
  suggestHook,
  suggestHooks,
} from "@/lib/prompter";

const IDLE: ActionState = { status: "idle" };
const NOTE_MAX = 280;

type Props = {
  badId: string;
  /** Colour of the Bad's gender (what represents a person, PARCOURS-DESIGN §1). */
  accent: "gold" | "red" | "cream";
  pseudo: string;
  charges: string[];
  souffleur: PrompterInput;
};

/**
 * La Demande de parloir (SPEC §7, maquette Demande.dc.html): the bet on the true charge, an
 * optional note and the Souffleur. The bet stays secret until the visit, for both.
 */
export function RequestModal({ badId, accent, pseudo, charges, souffleur }: Props) {
  const t = useTranslations("Relations.request");
  const errorT = useTranslations("Relations.errors");
  const prompterT = useTranslations("Prompter");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [guess, setGuess] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [state, formAction, pending] = useActionState(sendVisitRequestAction, IDLE);
  const noteId = useId();
  const templates: PrompterTemplates = {
    common: prompterT.raw("common") as string[],
    tribe: prompterT.raw("tribe") as string[],
    casier: prompterT.raw("casier") as string[],
    generic: prompterT.raw("generic") as string[],
  };

  function openModal() {
    setHooks(suggestHooks(souffleur, templates));
    setOpen(true);
  }

  function otherIdea(index: number) {
    setHooks((previous) => {
      const next = [...previous];
      const taken = previous
        .filter((hook, i) => i !== index && hook.kind === "generic")
        .map((hook) => hook.template);
      const slot = SLOTS[index];
      const current = previous[index];
      if (slot && current)
        next[index] = suggestHook(slot, souffleur, templates, { previous: current, taken });
      return next;
    });
  }

  const sent = state.status === "done";
  const length = [...note].length;

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={buttonClasses(
          "primary",
          "lg",
          "font-display w-full rounded-[4px] text-xl uppercase",
        )}
      >
        {t("open")}
      </button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          // Once filed, the Fiche shows « Demande déposée » instead of the button.
          if (state.status === "done") router.refresh();
        }}
        title={sent ? t("sentTitle") : t("title")}
      >
        {sent ? (
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <Stamp kind="requestFiled" surface="dark" size="md" tilt={-6} />
            <p className="text-cream/90">{t("sentBody", { pseudo })}</p>
            <p className="text-grey flex items-start gap-2 text-left text-sm">
              <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t("secret")}
            </p>
            <Link href="/demandes" className={buttonClasses("primary", "md", "w-full")}>
              {t("toMyRequests")}
            </Link>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="bad" value={badId} />
            <fieldset className="flex flex-col gap-2" data-accent={accent}>
              <legend className="font-display mb-2 text-2xl leading-tight uppercase">
                {t("question")}
              </legend>
              <div className="bg-cream flex flex-col gap-2 rounded-[4px] p-3">
                {charges.map((charge, index) => {
                  const value = index + 1;
                  const checked = guess === value;
                  return (
                    <label
                      key={charge}
                      className={cn(
                        "font-stamp has-focus-visible:outline-ink text-ink flex min-h-14 cursor-pointer items-start gap-3 rounded-[3px] border-2 bg-white p-3 text-[15px] leading-snug has-focus-visible:outline-3",
                        checked
                          ? "border-[3px] border-[var(--color-accent-ink)] bg-[#fbf5ea]"
                          : "border-[#cfc4ae]",
                      )}
                    >
                      <input
                        type="radio"
                        name="guess"
                        value={value}
                        checked={checked}
                        onChange={() => setGuess(value)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className="font-display text-xl leading-none text-[var(--color-accent-ink)]"
                      >
                        {value}
                      </span>
                      <span>
                        <span className="sr-only">{t("chargeNumber", { number: value })} </span>
                        {charge}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <p className="text-cream/90 flex items-start gap-2 text-[13px] leading-snug">
              <Lock aria-hidden="true" className="text-accent mt-0.5 size-4 shrink-0" />
              <span>
                {t.rich("secretHint", {
                  strong: (chunks) => <strong className="text-cream">{chunks}</strong>,
                })}
              </span>
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={noteId} className="text-sm font-bold">
                {t("note")} <span className="text-grey font-normal">{t("noteHint")}</span>
              </label>
              <textarea
                id={noteId}
                name="note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                aria-describedby={`${noteId}-count`}
                className="border-line bg-ink focus:border-accent w-full resize-none rounded-md border p-2.5 text-[15px] leading-snug focus:outline-none"
              />
              <span
                id={`${noteId}-count`}
                className={cn(
                  "self-end text-xs",
                  length > NOTE_MAX ? "text-red-bright font-bold" : "text-grey",
                )}
              >
                {t("count", { count: length, max: NOTE_MAX })}
              </span>
            </div>
            <section aria-labelledby={`${noteId}-souffleur`} className="flex flex-col gap-1.5">
              <h3
                id={`${noteId}-souffleur`}
                className="font-display text-accent text-[15px] uppercase"
              >
                {t("souffleur")}
              </h3>
              <p className="text-grey text-xs">{t("souffleurHint")}</p>
              <ul className="flex flex-col gap-1.5">
                {hooks.map((hook, index) => (
                  <li key={SLOTS[index]} className="flex items-stretch gap-1.5">
                    <button
                      type="button"
                      onClick={() => setNote(hook.text)}
                      className="border-line bg-ink hover:border-accent text-cream/90 flex-1 rounded-md border px-3 py-2.5 text-left text-[13px] leading-snug"
                    >
                      « {hook.text} »
                    </button>
                    <button
                      type="button"
                      onClick={() => otherIdea(index)}
                      aria-label={t("otherIdea")}
                      className="border-line text-grey hover:text-cream inline-flex w-11 shrink-0 items-center justify-center rounded-md border"
                    >
                      <RefreshCw aria-hidden="true" className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <button
              type="submit"
              disabled={pending || guess === null || length > NOTE_MAX}
              aria-busy={pending}
              className={buttonClasses(
                "primary",
                "lg",
                "font-display w-full rounded-[4px] text-xl uppercase",
              )}
            >
              {t("submit")}
            </button>
            {guess === null ? (
              <p className="text-grey -mt-2 text-center text-xs">{t("chooseFirst")}</p>
            ) : null}
            <p role="alert" className="text-red-bright min-h-5 text-sm font-medium">
              {state.status === "error" ? errorT(state.message as "generic") : null}
            </p>
          </form>
        )}
      </Modal>
    </>
  );
}
