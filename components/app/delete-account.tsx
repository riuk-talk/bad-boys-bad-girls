"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, type FormEvent } from "react";
import { deleteAccountAction } from "@/app/[locale]/(app)/ma-fiche/donnees/actions";
import type { ActionState } from "@/app/[locale]/(app)/relations-actions";
import { Turnstile, useCaptcha } from "@/components/auth/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const IDLE: ActionState = { status: "idle" };

/**
 * Supprimer mon compte (SPEC §10): password and an explicit confirmation, nothing else. The
 * password is checked by Supabase Auth, which asks for the anti-robot token when the captcha is on:
 * the button waits for it, like the sign-in form.
 */
export function DeleteAccount() {
  const t = useTranslations("MyData");
  const [state, submit, pending] = useActionState(deleteAccountAction, IDLE);
  const captcha = useCaptcha();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (captcha.gate.blocked) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => submit(data));
    // A token serves once: after a wrong password, the widget starts again.
    captcha.reset();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Input
        id="delete-password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={200}
        label={t("password")}
      />
      <label className="flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          name="confirm"
          required
          className="accent-accent mt-0.5 size-6 shrink-0"
        />
        <span>{t("confirm")}</span>
      </label>
      <Turnstile captcha={captcha} />
      <Button type="submit" variant="danger" disabled={pending || captcha.gate.blocked}>
        {t("delete")}
      </Button>
      <p role="alert" className="text-red-bright min-h-5 text-sm">
        {state.status === "error"
          ? t(
              `errors.${state.message === "wrongPassword" || state.message === "deleteConfirmRequired" || state.message === "captchaFailed" ? state.message : "generic"}`,
            )
          : null}
      </p>
    </form>
  );
}
