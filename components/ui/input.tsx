import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Field, controlClasses, describedBy } from "./field";

type InputProps = Omit<ComponentProps<"input">, "id"> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
};

export function Input({ id, label, hint, error, className, ...props }: InputProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(controlClasses, className)}
        {...props}
      />
    </Field>
  );
}
