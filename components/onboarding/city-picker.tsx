"use client";

import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { searchPlacesAction, type PlaceOption } from "@/app/[locale]/(app)/onboarding/actions";
import { controlClasses } from "@/components/ui/field";
import { cn } from "@/lib/cn";

type Props = { initial: { id: number; label: string } | null; error?: string };

/** Accessible combobox (WAI-ARIA 1.2 pattern) over the official communes list. */
export function CityPicker({ initial, error }: Props) {
  const t = useTranslations("Onboarding.identity");
  const id = useId();
  const [query, setQuery] = useState(initial?.label ?? "");
  const [selected, setSelected] = useState(initial);
  const [options, setOptions] = useState<PlaceOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [, startTransition] = useTransition();
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function search(value: string) {
    setQuery(value);
    setSelected(null);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      startTransition(async () => {
        const results = await searchPlacesAction(value);
        setOptions(results);
        setActive(results.length > 0 ? 0 : -1);
        setOpen(value.trim().length >= 2);
      });
    }, 250);
  }

  function choose(option: PlaceOption) {
    const label = `${option.name} (${option.postalCode})`;
    setSelected({ id: option.id, label });
    setQuery(label);
    setOpen(false);
  }

  const listId = `${id}-list`;
  const describedBy = [error ? `${id}-error` : `${id}-hint`, `${id}-status`].join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-input`} className="text-sm font-semibold">
        {t("city")}
      </label>
      <div className="relative">
        <MapPin
          aria-hidden="true"
          className="text-grey pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
        />
        <input
          id={`${id}-input`}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          placeholder={t("cityPlaceholder")}
          value={query}
          onChange={(event) => search(event.target.value)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((value) => Math.min(value + 1, options.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter" && active >= 0 && options[active]) {
              event.preventDefault();
              choose(options[active]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          className={cn(controlClasses, "pl-10")}
        />
        <input type="hidden" name="placeId" value={selected?.id ?? ""} />
        {open ? (
          <ul
            id={listId}
            role="listbox"
            aria-label={t("city")}
            className="border-line bg-ink-2 absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border py-1 shadow-[var(--shadow-paper)]"
          >
            {options.length === 0 ? (
              <li className="text-grey px-3.5 py-2.5">{t("cityNoResult")}</li>
            ) : (
              options.map((option, index) => (
                <li
                  key={option.id}
                  id={`${id}-opt-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3.5",
                    index === active ? "bg-gold text-ink" : "text-cream",
                  )}
                >
                  <span>{option.name}</span>
                  <span className={index === active ? "text-ink" : "text-grey"}>
                    {option.postalCode}
                  </span>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      <p id={`${id}-status`} className="sr-only" aria-live="polite">
        {open ? t("cityResults", { count: options.length }) : ""}
      </p>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-red-bright text-sm font-medium">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-grey text-sm">
          {t("cityHint")}
        </p>
      )}
    </div>
  );
}
