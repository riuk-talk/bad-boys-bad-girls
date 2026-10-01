"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Field, controlBase, describedBy } from "@/components/ui/field";
import { cn } from "@/lib/cn";

type Props = Omit<ComponentProps<"input">, "id" | "type"> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
};

export function PasswordInput({ id, label, hint, error, className, ...props }: Props) {
  const t = useTranslations("Auth");
  const [visible, setVisible] = useState(false);
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(controlBase, "pr-12 pl-3.5", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? t("hidePassword") : t("showPassword")}
          aria-pressed={visible}
          className="text-grey hover:text-cream absolute top-1/2 right-0 inline-flex size-11 -translate-y-1/2 items-center justify-center"
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="size-5" />
          ) : (
            <Eye aria-hidden="true" className="size-5" />
          )}
        </button>
      </div>
    </Field>
  );
}
