"use client";

import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * The offline state (SPEC §17): a banner, announced once, while the browser has no network.
 * Nothing is sent meanwhile; the pages read again when the connection is back.
 */
export function OfflineNotice() {
  const t = useTranslations("Common");
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  return (
    <div role="status" className={online ? "sr-only" : undefined}>
      {online ? null : (
        <p className="bg-cream text-ink flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold">
          <WifiOff aria-hidden="true" className="size-4 shrink-0" />
          {t("offline")}
        </p>
      )}
    </div>
  );
}
