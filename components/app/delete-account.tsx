"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { deleteAccountAction } from "@/app/[locale]/(app)/ma-fiche/donnees/actions";
import type { ActionState } from "@/app/[locale]/(app)/relations-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const IDLE: ActionState = { status: "idle" };

/** Supprimer mon compte (SPEC §10): password and an explicit confirmation, nothing else. */
export function DeleteAccount() {
  const t = useTranslations("MyData");
  const [state, submit, pending] = useActionState(deleteAccountAction, IDLE);
  return (
    <form action={submit} className="flex flex-col gap-4">
      <Input
        id="delete-password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={200}
        label={t("password")}
      />
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" name="confirm" required className="mt-1 size-5" />
        <span>{t("confirm")}</span>
      </label>
      <Button type="submit" variant="danger" disabled={pending}>
        {t("delete")}
      </Button>
      <p role="alert" className="text-red-bright min-h-5 text-sm">
        {state.status === "error"
          ? t(
              `errors.${state.message === "wrongPassword" || state.message === "deleteConfirmRequired" ? state.message : "generic"}`,
            )
          : null}
      </p>
    </form>
  );
}
