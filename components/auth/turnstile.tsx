"use client";

import { RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useReducer, useRef, useState, type Dispatch } from "react";
import {
  captchaGate,
  captchaReducer,
  initialCaptcha,
  CAPTCHA_FIELD,
  LOAD_TIMEOUT_MS,
  type CaptchaEvent,
} from "@/lib/auth/captcha";
import { CaptchaPlaceholder } from "./captcha-placeholder";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;

// Loaded on demand from a nonce-trusted script, so the strict CSP ('strict-dynamic') allows it.
function loadTurnstile(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      script.remove();
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * « Réessayer » after a script that never answered: forget it and load a fresh one. A script
 * already loaded (window.turnstile) is kept: the widget is simply rendered again.
 */
function forgetPendingScript() {
  if (window.turnstile) return;
  scriptPromise = null;
  document.querySelectorAll(`script[src="${SCRIPT_URL}"]`).forEach((script) => script.remove());
}

/**
 * The state of the anti-robot check for one form. `reset()` after each submission (tokens are
 * single-use) and for « Réessayer »: the widget is mounted again and the button waits for a new
 * token. Without a site key (local development, preview) the state is « off »: nothing changes.
 */
export function useCaptcha(enabled = true) {
  const siteKey = enabled ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY : undefined;
  const [state, dispatch] = useReducer(captchaReducer, siteKey, initialCaptcha);
  const [generation, setGeneration] = useState(0);
  return {
    siteKey,
    state,
    dispatch,
    generation,
    gate: captchaGate(state),
    reset: () => {
      forgetPendingScript();
      dispatch({ type: "retry" });
      setGeneration((value) => value + 1);
    },
  };
}

export type Captcha = ReturnType<typeof useCaptcha>;

/**
 * Cloudflare Turnstile. The token lands in the "cf-turnstile-response" form field and is verified
 * by Supabase Auth (captcha protection); the form is told of every token, expiry and error so its
 * button waits for a token. An expired token is renewed by Turnstile itself (refresh-expired).
 */
export function Turnstile({ captcha }: { captcha: Captcha }) {
  const t = useTranslations("Auth");
  if (!captcha.siteKey) return <CaptchaPlaceholder />;
  const { notice } = captcha.gate;
  return (
    <div className="space-y-2">
      <Widget key={captcha.generation} siteKey={captcha.siteKey} onEvent={captcha.dispatch} />
      <div role="status" aria-live="polite" className="text-sm">
        {notice === "checking" ? <p className="text-grey">{t("captchaChecking")}</p> : null}
        {notice === "unavailable" ? (
          <div className="space-y-2">
            <p className="text-red-bright font-medium">{t("captchaUnavailable")}</p>
            <button
              type="button"
              onClick={captcha.reset}
              className="border-line text-cream hover:border-gold inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-semibold"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              {t("captchaRetry")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Widget({ siteKey, onEvent }: { siteKey: string; onEvent: Dispatch<CaptchaEvent> }) {
  const locale = useLocale();
  const t = useTranslations("Auth");
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    // Blocked by an ad blocker or a browser shield, the script may never answer: 10 s at most.
    const timer = window.setTimeout(() => {
      if (!cancelled && !widgetId) onEvent({ type: "timeout" });
    }, LOAD_TIMEOUT_MS);
    loadTurnstile()
      .then(() => {
        if (cancelled) return;
        if (!container.current || !window.turnstile) {
          onEvent({ type: "error" });
          return;
        }
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme: "dark",
          language: locale,
          "response-field-name": CAPTCHA_FIELD,
          "refresh-expired": "auto",
          callback: (token: string) => onEvent({ type: "token", token }),
          "expired-callback": () => onEvent({ type: "expired" }),
          "error-callback": () => {
            onEvent({ type: "error" });
            // Handled here: Turnstile does not retry on its own, « Réessayer » does.
            return true;
          },
        });
      })
      .catch(() => {
        if (!cancelled) onEvent({ type: "error" });
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, locale, onEvent]);

  return <div ref={container} role="group" aria-label={t("captchaLabel")} className="min-h-16" />;
}
