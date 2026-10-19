"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

// Back and forward show the router's cached copy of a page: its counters may be old (Phase 6a,
// the unread messages of the Tableau des visites). The moment of the last one is noted here.
let poppedAt = 0;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    poppedAt = Date.now();
  });
}

/** Reads the page again when it was reached by « back » or « forward » (never on a normal visit). */
export function FreshOnReturn() {
  const router = useRouter();
  useEffect(() => {
    if (Date.now() - poppedAt < 2000) router.refresh();
  }, [router]);
  return null;
}
