"use client";

import { useEffect } from "react";
import { vitalPage, type Vital, type VitalMetric } from "@/lib/vitals";

/**
 * Real Core Web Vitals (SPEC §18): LCP, CLS and INP of the page loaded, sent once the page is
 * hidden (navigator.sendBeacon), reduced to its template. The library is loaded after the page,
 * outside the initial JavaScript. Client navigations add to the CLS and INP of the first page.
 */
export function WebVitals() {
  useEffect(() => {
    const page = vitalPage(window.location.pathname);
    const pending = new Map<VitalMetric, Vital>();
    let cancelled = false;

    const flush = () => {
      if (pending.size === 0) return;
      const body = JSON.stringify([...pending.values()]);
      pending.clear();
      navigator.sendBeacon("/api/vitals", new Blob([body], { type: "application/json" }));
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", flush);

    void import("web-vitals").then(({ onCLS, onINP, onLCP }) => {
      if (cancelled) return;
      const keep = ({ name, value }: { name: VitalMetric; value: number }) => {
        pending.set(name, { page, metric: name, value });
      };
      onLCP(keep);
      onCLS(keep);
      onINP(keep);
    });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", flush);
    };
  }, []);
  return null;
}
