"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/browser";

type State =
  | { step: "loading" }
  | { step: "enroll"; factorId: string; qr: string; secret: string }
  | { step: "verify"; factorId: string }
  | { step: "error" };

/**
 * Second factor (TOTP) for /admin (Phase 5a-ter): enrolment the first time (QR code + key to type
 * by hand), then a 6-digit code at each session. Supabase Auth raises the session to aal2; the
 * database checks that level in every admin function (is_admin()).
 */
export function AdminMfa() {
  const t = useTranslations("AdminAccess");
  const router = useRouter();
  const [state, setState] = useState<State>({ step: "loading" });
  const [code, setCode] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void prepare().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.step !== "enroll" && state.step !== "verify") return;
    setPending(true);
    const { error } = await createClient().auth.mfa.challengeAndVerify({
      factorId: state.factorId,
      code: code.trim(),
    });
    setPending(false);
    if (error) {
      setInvalid(true);
      setCode("");
      return;
    }
    // The dashboard (decision 10-9). One navigation: the admin pages are dynamic, so the server
    // renders them again with the new level (aal2). A refresh on top raced it (iPhone, 10c).
    router.replace("/admin");
  }

  if (state.step === "loading") return <p className="text-grey">{t("loading")}</p>;
  if (state.step === "error")
    return (
      <p role="alert" className="text-red-bright">
        {t("error")}
      </p>
    );

  return (
    <div className="space-y-6">
      <p className="text-grey">{state.step === "enroll" ? t("leadEnroll") : t("leadVerify")}</p>
      {state.step === "enroll" ? (
        <div className="space-y-3">
          <Image
            src={state.qr}
            alt={t("qrAlt")}
            width={200}
            height={200}
            unoptimized
            className="rounded-lg bg-white p-2"
          />
          <p className="text-sm">
            <span className="text-grey">{t("secretLabel")} </span>
            <code data-testid="totp-secret" className="font-mono break-all">
              {state.secret}
            </code>
          </p>
        </div>
      ) : null}
      <form onSubmit={submit} className="max-w-xs space-y-4">
        <Input
          id="totp-code"
          label={t("codeLabel")}
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
          error={invalid ? t("invalid") : undefined}
        />
        <Button type="submit" disabled={pending}>
          {t("submit")}
        </Button>
      </form>
    </div>
  );
}

/** A verified factor: ask for a code. Otherwise start a clean enrolment. */
async function prepare(): Promise<State> {
  const mfa = createClient().auth.mfa;
  const { data, error } = await mfa.listFactors();
  if (error) return { step: "error" };
  const verified = data.totp[0];
  if (verified) return { step: "verify", factorId: verified.id };
  // An enrolment left unfinished (page closed before the code): start again from scratch.
  for (const factor of data.all) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await mfa.unenroll({ factorId: factor.id });
    }
  }
  const enrolled = await mfa.enroll({ factorType: "totp" });
  if (enrolled.error) return { step: "error" };
  return {
    step: "enroll",
    factorId: enrolled.data.id,
    qr: enrolled.data.totp.qr_code,
    secret: enrolled.data.totp.secret,
  };
}
