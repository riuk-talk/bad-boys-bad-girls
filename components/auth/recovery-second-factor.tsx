"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/browser";

/**
 * Password recovery for an account with a second factor (the super admin, Phase 5a-ter):
 * Supabase Auth changes the password only at aal2, so the recovery session first passes the
 * TOTP code; the page then shows the new password form. Nothing is relaxed: recovery link and
 * second factor are both required.
 */
export function RecoverySecondFactor({ factorId }: { factorId: string }) {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const { error } = await createClient().auth.mfa.challengeAndVerify({
      factorId,
      code: code.trim(),
    });
    setPending(false);
    if (error) {
      setInvalid(true);
      setCode("");
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <h2 className="font-display text-2xl uppercase">{t("recoveryFactorTitle")}</h2>
      <p className="text-cream/85">{t("recoveryFactorLead")}</p>
      <Input
        id="recovery-totp"
        label={t("recoveryFactorCode")}
        value={code}
        onChange={(event) => {
          setCode(event.target.value);
          setInvalid(false);
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        error={invalid ? t("recoveryFactorInvalid") : undefined}
      />
      <Button type="submit" disabled={pending}>
        {t("recoveryFactorSubmit")}
      </Button>
    </form>
  );
}
