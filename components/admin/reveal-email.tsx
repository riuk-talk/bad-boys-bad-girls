"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { revealEmailAction } from "@/app/[locale]/(app)/admin/membres/[id]/email-action";

/** « Afficher l'e-mail » (10i): the address only after this click, each showing logged. */
export function RevealEmail({ memberId }: { memberId: string }) {
  const t = useTranslations("AdminShell.email");
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (email)
    return (
      <span className="break-all" data-testid="member-email">
        {email}
      </span>
    );
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const result = await revealEmailAction(memberId).catch(() => null);
          setPending(false);
          if (result && "email" in result) setEmail(result.email);
          else setError(result?.error ?? "generic");
        }}
        className="border-cream/80 hover:bg-cream hover:text-ink inline-flex min-h-11 items-center rounded-full border-2 px-4 text-sm font-semibold disabled:opacity-60"
      >
        {t("show")}
      </button>
      <span className="text-grey text-xs">{t("logged")}</span>
      {error ? (
        <span role="alert" className="text-red-bright text-sm">
          {t(`errors.${error as "generic"}`)}
        </span>
      ) : null}
    </span>
  );
}
