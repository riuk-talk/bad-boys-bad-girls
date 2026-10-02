"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import type * as z from "zod/mini";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import {
  fieldErrors,
  magicLinkSchema,
  passwordLoginSchema,
  signupSchema,
  type AuthErrorKey,
} from "@/lib/validation/auth";
import { CaptchaPlaceholder } from "./captcha-placeholder";
import { PasswordInput } from "./password-input";

type Errors = Partial<Record<string, AuthErrorKey>>;

/**
 * Phase 1: UI and client-side validation only. Submissions are wired to Supabase Auth
 * (with Turnstile and server-side Zod validation) in Phase 2.
 */
function useAuthForm(schema: z.ZodMiniType) {
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const nextErrors = fieldErrors(parsed.error);
      setErrors(nextErrors);
      setSubmitted(false);
      const firstField = Object.keys(nextErrors)[0];
      const control = firstField ? event.currentTarget.elements.namedItem(firstField) : null;
      if (control instanceof HTMLElement) control.focus();
      return;
    }
    setErrors({});
    setSubmitted(true);
  }

  return { errors, submitted, onSubmit };
}

function NotYetOpen({ show }: { show: boolean }) {
  const t = useTranslations("Auth");
  return (
    <p role="status" className="text-gold min-h-6">
      {show ? t("notYetOpen") : null}
    </p>
  );
}

export function LoginForm() {
  const t = useTranslations("Auth");
  const id = useId();
  const [mode, setMode] = useState<"password" | "magic">("password");
  const { errors, submitted, onSubmit } = useAuthForm(
    mode === "password" ? passwordLoginSchema : magicLinkSchema,
  );
  const error = (key?: AuthErrorKey) => (key ? t(`errors.${key}`) : undefined);

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t("modeLabel")}</legend>
        <div className="bg-ink-2 grid grid-cols-2 gap-2 rounded-full p-1">
          {(["password", "magic"] as const).map((value) => (
            <label
              key={value}
              className="has-checked:bg-gold has-checked:text-ink has-focus-visible:outline-gold flex min-h-11 cursor-pointer items-center justify-center rounded-full px-3 text-center text-sm font-semibold has-focus-visible:outline-3"
            >
              <input
                type="radio"
                name="mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                className="sr-only"
              />
              {value === "password" ? t("modePassword") : t("modeMagicLink")}
            </label>
          ))}
        </div>
      </fieldset>
      <Input
        id={`${id}-email`}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        label={t("email")}
        error={error(errors.email)}
      />
      {mode === "password" ? (
        <PasswordInput
          id={`${id}-password`}
          name="password"
          autoComplete="current-password"
          label={t("password")}
          error={error(errors.password)}
        />
      ) : (
        <p className="text-grey text-sm">{t("magicLinkHint")}</p>
      )}
      <CaptchaPlaceholder />
      <Button type="submit" size="lg" className="w-full">
        {mode === "password" ? t("submitLogin") : t("submitMagicLink")}
      </Button>
      <NotYetOpen show={submitted} />
      <p className="text-center">
        <Link
          href="/mot-de-passe-oublie"
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {t("forgotLink")}
        </Link>
      </p>
      <p className="text-grey text-center">
        {t("noAccount")}{" "}
        <Link
          href="/inscription"
          className="text-gold inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        >
          {t("submitSignup")}
        </Link>
      </p>
    </form>
  );
}

const richLink = (href: string) =>
  function RichLink(chunks: ReactNode) {
    return (
      <Link href={href} className="text-gold underline underline-offset-2">
        {chunks}
      </Link>
    );
  };

export function SignupForm() {
  const t = useTranslations("Auth");
  const id = useId();
  const { errors, submitted, onSubmit } = useAuthForm(signupSchema);
  const error = (key?: AuthErrorKey) => (key ? t(`errors.${key}`) : undefined);

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-5">
      <Input
        id={`${id}-email`}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        label={t("email")}
        hint={t("emailHint")}
        error={error(errors.email)}
      />
      <PasswordInput
        id={`${id}-password`}
        name="password"
        autoComplete="new-password"
        minLength={12}
        label={t("password")}
        hint={t("passwordHint")}
        error={error(errors.password)}
      />
      <p className="text-grey text-sm">{t("adultNotice")}</p>
      <CaptchaPlaceholder />
      <p className="text-sm">
        {t.rich("termsNotice", {
          terms: richLink("/cgu"),
          charter: richLink("/charte"),
          privacy: richLink("/confidentialite"),
        })}
      </p>
      <Button type="submit" size="lg" className="w-full">
        {t("submitSignup")}
      </Button>
      <NotYetOpen show={submitted} />
      <p className="text-grey text-center">
        {t("hasAccount")}{" "}
        <Link
          href="/connexion"
          className="text-gold inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        >
          {t("submitLogin")}
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const t = useTranslations("Auth");
  const id = useId();
  const { errors, submitted, onSubmit } = useAuthForm(magicLinkSchema);
  return (
    <form noValidate onSubmit={onSubmit} className="space-y-5">
      <Input
        id={`${id}-email`}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        label={t("email")}
        error={errors.email ? t(`errors.${errors.email}`) : undefined}
      />
      <CaptchaPlaceholder />
      <Button type="submit" size="lg" className="w-full">
        {t("submitForgot")}
      </Button>
      <NotYetOpen show={submitted} />
    </form>
  );
}
