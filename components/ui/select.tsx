import type { ComponentProps, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Field, controlBase, describedBy } from "./field";

type Option = { value: string; label: string };

type SelectProps = Omit<ComponentProps<"select">, "id"> & {
  id: string;
  label: ReactNode;
  options: Option[];
  placeholder?: string;
  hint?: ReactNode;
  error?: ReactNode;
};

export function Select({
  id,
  label,
  options,
  placeholder,
  hint,
  error,
  className,
  ...props
}: SelectProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(controlBase, "appearance-none pr-10 pl-3.5", className)}
          {...props}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="text-grey pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2"
        />
      </div>
    </Field>
  );
}
