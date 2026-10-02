import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type CheckboxProps = Omit<ComponentProps<"input">, "id" | "type"> & {
  id: string;
  label: ReactNode;
  error?: ReactNode;
};

export function Checkbox({ id, label, error, className, ...props }: CheckboxProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn("accent-gold mt-0.5 size-6 shrink-0", className)}
          {...props}
        />
        <label htmlFor={id} className="text-base leading-snug">
          {label}
        </label>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-red-bright pl-9 text-sm font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}
