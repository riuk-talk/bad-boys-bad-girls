"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

// Must stay free of next-intl: strings come from <ErrorStrings /> (rendered in the layout).
const ERROR_STRINGS_ID = "i18n-error-strings";
type Strings = { stamp: string; title: string; body: string; retry: string };
const EMPTY: Strings = { stamp: "", title: "", body: "", retry: "" };
let cached: Strings | null = null;

function readStrings(): Strings {
  if (!cached) {
    const data = document.getElementById(ERROR_STRINGS_ID)?.dataset;
    cached = data
      ? {
          stamp: data.stamp ?? "",
          title: data.title ?? "",
          body: data.body ?? "",
          retry: data.retry ?? "",
        }
      : EMPTY;
  }
  return cached;
}

const subscribe = () => () => {};

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  const strings = useSyncExternalStore(subscribe, readStrings, () => EMPTY);
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-4 text-center focus:outline-none"
    >
      <span
        aria-hidden="true"
        className="border-red-bright font-stamp text-red-bright -rotate-6 border-[3px] px-6 py-2 text-3xl tracking-[0.12em] uppercase"
      >
        {strings.stamp}
      </span>
      <h1 className="font-display text-4xl tracking-wide uppercase sm:text-5xl">{strings.title}</h1>
      <p className="text-cream/85 text-lg">{strings.body}</p>
      <Button onClick={reset}>{strings.retry}</Button>
    </main>
  );
}
