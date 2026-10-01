"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "success" | "error";
type ToastItem = { id: number; message: string; tone: Tone };
type ToastApi = { show: (message: string, tone?: Tone) => void };

const ToastContext = createContext<ToastApi | null>(null);
const DURATION_MS = 5000;

const tones: Record<Tone, string> = {
  neutral: "border-line",
  success: "border-gold",
  error: "border-red-bright",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("Components.toast");
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: Tone = "neutral") => {
      const id = Date.now() + Math.random();
      setItems((current) => [...current.slice(-2), { id, message, tone }]);
      window.setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        aria-label={t("region")}
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "animate-toast bg-ink-3 text-cream pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-lg border-l-4 px-4 py-3 shadow-[var(--shadow-paper)]",
              tones[item.tone],
            )}
          >
            <p>{item.message}</p>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label={t("dismiss")}
              className="text-grey hover:text-cream inline-flex size-11 shrink-0 items-center justify-center rounded-full"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
        ))}
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}
