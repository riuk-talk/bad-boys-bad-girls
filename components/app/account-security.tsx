"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useId, useRef, useState, type FormEvent } from "react";
import {
  changeEmailAction,
  changePasswordAction,
} from "@/app/[locale]/(app)/ma-fiche/account-security-actions";
import { EmailHint } from "@/components/auth/email-hint";
import { PasswordInput } from "@/components/auth/password-input";
import { Turnstile, useCaptcha } from "@/components/auth/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FieldKey, SecurityState } from "@/lib/auth/account-security";
import { emailWarning, type EmailWarning } from "@/lib/auth/email-typo";

const IDLE: SecurityState = { status: "idle" };

/** The submit of a form with the anti-robot check: one token per submission. */
function useSecureForm(action: (state: SecurityState, form: FormData) => Promise<SecurityState>) {
  const [state, submit, pending] = useActionState(action, IDLE);
  const captcha = useCaptcha();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (captcha.gate.blocked) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => submit(data));
    // A token serves once: after an error, the widget starts again.
    captcha.reset();
  }
  return { state, pending, captcha, onSubmit };
}

function useFieldError() {
  const auth = useTranslations("Auth");
  return (state: SecurityState, field: "current" | "password" | "email") => {
    const key: FieldKey | undefined = state.status === "error" ? state.fields?.[field] : undefined;
    return key ? auth(`errors.${key}`) : undefined;
  };
}

function FormAlert({ state }: { state: SecurityState }) {
  const t = useTranslations("AccountSecurity");
  return (
    <p role="alert" className="text-red-bright min-h-5 text-sm">
      {state.status === "error" && state.message ? t(`errors.${state.message}`) : null}
    </p>
  );
}

/** Changer de mot de passe (10j): the current one, the new one, the anti-robot check. */
export function PasswordChange() {
  const t = useTranslations("AccountSecurity");
  const auth = useTranslations("Auth");
  const id = useId();
  const form = useSecureForm(changePasswordAction);
  const fieldError = useFieldError();

  if (form.state.status === "done") {
    return (
      <p role="status" className="border-line bg-ink-2 rounded-md border p-4 font-semibold">
        {t("password.done")}
      </p>
    );
  }
  return (
    <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-5">
      <PasswordInput
        id={`${id}-current`}
        name="current"
        autoComplete="current-password"
        required
        maxLength={200}
        label={t("current")}
        error={fieldError(form.state, "current")}
      />
      <PasswordInput
        id={`${id}-new`}
        name="password"
        autoComplete="new-password"
        required
        minLength={12}
        maxLength={128}
        label={t("password.new")}
        hint={auth("passwordHint")}
        error={fieldError(form.state, "password")}
      />
      <Turnstile captcha={form.captcha} />
      <Button type="submit" disabled={form.pending || form.captcha.gate.blocked}>
        {t("password.submit")}
      </Button>
      <FormAlert state={form.state} />
    </form>
  );
}

/**
 * Changer d'e-mail (10j): the new address (a mistyped domain is pointed out, never refused, as at
 * sign-up), the current password, the anti-robot check.
 */
export function EmailChange() {
  const t = useTranslations("AccountSecurity");
  const id = useId();
  const form = useSecureForm(changeEmailAction);
  const fieldError = useFieldError();
  const emailInput = useRef<HTMLInputElement>(null);
  const [warning, setWarning] = useState<EmailWarning | null>(null);

  if (form.state.status === "sent") {
    const to = form.state.to;
    return (
      <p role="status" className="border-line bg-ink-2 rounded-md border p-4 break-words">
        {t.rich("email.sent", { strong: () => <strong className="break-all">{to}</strong> })}
      </p>
    );
  }
  return (
    <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-5">
      <Input
        ref={emailInput}
        id={`${id}-email`}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        maxLength={254}
        label={t("email.new")}
        onBlur={(event) => setWarning(emailWarning(event.currentTarget.value))}
        onChange={() => setWarning(null)}
        error={fieldError(form.state, "email")}
      />
      <EmailHint
        warning={warning}
        onAccept={(email) => {
          if (emailInput.current) emailInput.current.value = email;
          setWarning(null);
          emailInput.current?.focus();
        }}
      />
      <PasswordInput
        id={`${id}-current`}
        name="current"
        autoComplete="current-password"
        required
        maxLength={200}
        label={t("current")}
        error={fieldError(form.state, "current")}
      />
      <Turnstile captcha={form.captcha} />
      <Button type="submit" disabled={form.pending || form.captcha.gate.blocked}>
        {t("email.submit")}
      </Button>
      <FormAlert state={form.state} />
    </form>
  );
}
