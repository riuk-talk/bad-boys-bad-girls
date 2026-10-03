"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { CaptchaPlaceholder } from "./captcha-placeholder";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
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
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Cloudflare Turnstile. The token lands in the "cf-turnstile-response" form field and is verified
 * by Supabase Auth (captcha protection). Re-mount it (React key) after each submission: tokens are
 * single-use. Without a site key (local development), a neutral placeholder is shown.
 */
export function Turnstile() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const locale = useLocale();
  const t = useTranslations("Auth");
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!siteKey) return;
    let widgetId: string | undefined;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme: "dark",
          language: locale,
          "response-field-name": "cf-turnstile-response",
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, locale]);

  if (!siteKey) return <CaptchaPlaceholder />;
  return <div ref={container} role="group" aria-label={t("captchaLabel")} className="min-h-16" />;
}
