"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { controlClasses } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

export function CopyLink({ url }: { url: string }) {
  const t = useTranslations("Quarter");
  const toast = useToast();
  const id = useId();
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-semibold">
          {t("referralLabel")}
        </label>
        <input
          id={id}
          readOnly
          value={url}
          onFocus={(event) => event.target.select()}
          className={controlClasses}
        />
      </div>
      <Button
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          toast.show(t("copied"), "success");
        }}
      >
        <Copy aria-hidden="true" className="size-5" />
        {t("copy")}
      </Button>
    </div>
  );
}
