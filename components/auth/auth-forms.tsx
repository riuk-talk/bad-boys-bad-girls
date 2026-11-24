"use client";

import { MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Role } from "@/lib/onboarding/config";
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import * as z from "zod/mini";
import {
  sendResetAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
  type AuthState,
} from "@/app/[locale]/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import type { AuthMessageKey } from "@/lib/auth/errors";
import { emailWarning, type EmailWarning } from "@/lib/auth/email-typo";
import { EmailHint } from "./email-hint";
import {
  fieldErrors,
  magicLinkSchema,
  passwordLoginSchema,
  passwordSchema,
  signupSchema,
  type AuthErrorKey,
} from "@/lib/validation/auth";
import { PasswordInput } from "./password-input";
import { Turnstile, useCaptcha } from "./turnstile";

type Errors = Partial<Record<string, AuthErrorKey>>;
type Action = (state: AuthState, form: FormData) => Promise<AuthState>;
const IDLE: AuthState = { status: "idle" };

/**
 * Client validation for instant feedback, then the server action validates again (Zod) and talks
 * to Supabase Auth. Field errors focus the first invalid field.
 */
function useAuthForm(
  action: Action,
  schema: () => z.ZodMiniType,
  { captcha: withCaptcha = true }: { captcha?: boolean } = {},
) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [clientErrors, setClientErrors] = useState<Errors | null>(null);
  const [attempt, setAttempt] = useState(0);
  const captcha = useCaptcha(withCaptcha);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // No token from the anti-robot check yet: Supabase Auth would refuse the request.
    if (captcha.gate.blocked) {
      event.preventDefault();
      return;
    }
    const parsed = schema().safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) {
      event.preventDefault();
      const errors = fieldErrors(parsed.error);
      setClientErrors(errors);
      const first = Object.keys(errors)[0];
      const control = first ? event.currentTarget.elements.namedItem(first) : null;
      if (control instanceof HTMLElement) control.focus();
      return;
    }
    event.preventDefault();
    setClientErrors(null);
    setAttempt((value) => value + 1);
    // No <form action>: React 19 would reset the fields after an error answer.
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
    // A token serves once: the widget starts again and the button waits for a new one.
    captcha.reset();
  }

  const errors: Errors = clientErrors ?? (state.status === "error" ? (state.fields ?? {}) : {});
  const message = state.status === "error" ? state.message : undefined;
  return { state, formAction, pending, onSubmit, errors, message, attempt, captcha };
}

function FormMessage({ message }: { message?: AuthMessageKey }) {
  const t = useTranslations("Auth.errors");
  return (
    <p role="alert" className="text-red-bright min-h-6 font-medium">
      {message ? t(message) : null}
    </p>
  );
}

function SentPanel({
  body,
  extra,
  children,
}: {
  body: string;
  extra?: ReactNode;
  children?: ReactNode;
}) {
  const t = useTranslations("Auth");
  return (
    <div
      role="status"
      className="border-gold/60 bg-gold/10 flex flex-col items-center gap-3 rounded-[var(--radius-card)] border p-6 text-center"
    >
      <MailCheck aria-hidden="true" className="text-gold size-10" />
      <h2 className="font-display text-2xl tracking-wide uppercase">{t("checkEmailTitle")}</h2>
      <p>{body}</p>
      {extra ? <p className="text-sm">{extra}</p> : null}
      {children}
    </div>
  );
}

function SubmitButton({
  pending,
  blocked = false,
  children,
}: {
  pending: boolean;
  /** No token from the anti-robot check yet (lib/auth/captcha.ts). */
  blocked?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("Auth");
  return (
    <Button
      type="submit"
      size="lg"
      className="w-full"
      disabled={pending || blocked}
      aria-busy={pending}
    >
      {pending ? t("submitting") : children}
    </Button>
  );
}

const linkClass =
  "inline-flex min-h-11 items-center font-semibold text-gold underline underline-offset-4";

export function LoginForm({ initialMessage }: { initialMessage?: AuthMessageKey }) {
  const t = useTranslations("Auth");
  const id = useId();
  const [mode, setMode] = useState<"password" | "magic">("password");
  const form = useAuthForm(signInAction, () =>
    mode === "password" ? passwordLoginSchema : magicLinkSchema,
  );
  const error = (key?: AuthErrorKey) => (key ? t(`errors.${key}`) : undefined);

  if (form.state.status === "sent") return <SentPanel body={t("checkEmailBody")} />;
  const shownMessage = form.message ?? (form.attempt === 0 ? initialMessage : undefined);
  const wrongPassword = shownMessage === "invalidCredentials";

  return (
    <form noValidate onSubmit={form.onSubmit} className="space-y-5">
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
        error={error(form.errors.email)}
      />
      {mode === "password" ? (
        <PasswordInput
          id={`${id}-password`}
          name="password"
          autoComplete="current-password"
          label={t("password")}
          error={error(form.errors.password)}
        />
      ) : (
        <p className="text-grey text-sm">{t("magicLinkHint")}</p>
      )}
      <Turnstile captcha={form.captcha} />
      <SubmitButton pending={form.pending} blocked={form.captcha.gate.blocked}>
        {mode === "password" ? t("submitLogin") : t("submitMagicLink")}
      </SubmitButton>
      <FormMessage message={shownMessage} />
      {/* A wrong password: the way out is right under the message, the only « Mot de passe
          oublié ? » link of the form then (no second one at the bottom). */}
      <p className={wrongPassword ? "-mt-3 text-center" : "text-center"}>
        <Link
          href="/mot-de-passe-oublie"
          className={
            wrongPassword
              ? "text-gold inline-flex min-h-11 items-center text-lg font-bold underline underline-offset-4"
              : "inline-flex min-h-11 items-center underline underline-offset-4"
          }
        >
          {t("forgotLink")}
        </Link>
      </p>
      <p className="text-grey text-center">
        {t("noAccount")}{" "}
        <Link href="/inscription" className={linkClass}>
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

export function SignupForm({ referralCode, role }: { referralCode?: string; role?: Role }) {
  const t = useTranslations("Auth");
  const id = useId();
  const form = useAuthForm(signUpAction, () => signupSchema);
  const error = (key?: AuthErrorKey) => (key ? t(`errors.${key}`) : undefined);
  const emailInput = useRef<HTMLInputElement>(null);
  const [warning, setWarning] = useState<EmailWarning | null>(null);
  // The address sent (shown on the panel) and « Corriger », back to the form filled in.
  const [sentTo, setSentTo] = useState("");
  const [correcting, setCorrecting] = useState(false);

  useEffect(() => {
    if (correcting) emailInput.current?.focus();
  }, [correcting]);

  // The same answer for an address already registered (no account enumeration), with the way
  // in for whoever already has an account.
  if (form.state.status === "sent" && !correcting) {
    return (
      <SentPanel
        body={t("checkEmailBody")}
        extra={t.rich("checkEmailExisting", {
          login: richLink("/connexion"),
          reset: richLink("/mot-de-passe-oublie"),
        })}
      >
        {sentTo ? (
          <>
            <p className="break-all">
              {t.rich("sentTo", {
                email: () => <strong>{sentTo}</strong>,
              })}
            </p>
            <p className="text-sm">
              {t("wrongAddress")}{" "}
              <button
                type="button"
                onClick={() => setCorrecting(true)}
                className="text-gold inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
              >
                {t("correct")}
              </button>
            </p>
          </>
        ) : null}
      </SentPanel>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        setSentTo(emailInput.current?.value.trim() ?? "");
        setCorrecting(false);
        form.onSubmit(event);
      }}
      className="space-y-5"
    >
      {referralCode ? <input type="hidden" name="ref" value={referralCode} /> : null}
      {role ? <input type="hidden" name="role" value={role} /> : null}
      <Input
        ref={emailInput}
        id={`${id}-email`}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        label={t("email")}
        hint={t("emailHint")}
        defaultValue={sentTo}
        onBlur={(event) => setWarning(emailWarning(event.currentTarget.value))}
        onChange={() => setWarning(null)}
        error={error(form.errors.email)}
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
        id={`${id}-password`}
        name="password"
        autoComplete="new-password"
        minLength={12}
        label={t("password")}
        hint={t("passwordHint")}
        error={error(form.errors.password)}
      />
      <p className="text-grey text-sm">{t("adultNotice")}</p>
      <Turnstile captcha={form.captcha} />
      <p className="text-sm">
        {t.rich("termsNotice", {
          terms: richLink("/cgu"),
          charter: richLink("/charte"),
          privacy: richLink("/confidentialite"),
        })}
      </p>
      <SubmitButton pending={form.pending} blocked={form.captcha.gate.blocked}>
        {t("submitSignup")}
      </SubmitButton>
      <FormMessage message={form.message} />
      <p className="text-grey text-center">
        {t("hasAccount")}{" "}
        <Link href="/connexion" className={linkClass}>
          {t("submitLogin")}
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const t = useTranslations("Auth");
  const id = useId();
  const form = useAuthForm(sendResetAction, () => magicLinkSchema);

  if (form.state.status === "sent") return <SentPanel body={t("resetSentBody")} />;

  return (
    <form noValidate onSubmit={form.onSubmit} className="space-y-5">
      <Input
        id={`${id}-email`}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        label={t("email")}
        error={form.errors.email ? t(`errors.${form.errors.email}`) : undefined}
      />
      <Turnstile captcha={form.captcha} />
      <SubmitButton pending={form.pending} blocked={form.captcha.gate.blocked}>
        {t("submitForgot")}
      </SubmitButton>
      <FormMessage message={form.message} />
    </form>
  );
}

export function NewPasswordForm() {
  const t = useTranslations("Auth");
  const id = useId();
  // Changing the password (updateUser) is not protected by the captcha: no widget here.
  const form = useAuthForm(updatePasswordAction, () => passwordOnly, { captcha: false });

  return (
    <form noValidate onSubmit={form.onSubmit} className="space-y-5">
      <PasswordInput
        id={`${id}-password`}
        name="password"
        autoComplete="new-password"
        minLength={12}
        label={t("password")}
        hint={t("passwordHint")}
        error={form.errors.password ? t(`errors.${form.errors.password}`) : undefined}
      />
      <SubmitButton pending={form.pending} blocked={form.captcha.gate.blocked}>
        {t("submitNewPassword")}
      </SubmitButton>
      <FormMessage message={form.message} />
    </form>
  );
}

const passwordOnly = z.object({ password: passwordSchema });
