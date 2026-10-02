import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Field, controlClasses, describedBy } from "./field";

type TextareaProps = Omit<ComponentProps<"textarea">, "id"> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
};

export function Textarea({ id, label, hint, error, className, ...props }: TextareaProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(controlClasses, "min-h-32 resize-y", className)}
        {...props}
      />
    </Field>
  );
}
