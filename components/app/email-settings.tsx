import { getTranslations } from "next-intl/server";
import { updateEmailPreferencesAction } from "@/app/[locale]/(app)/email-actions";
import { Button } from "@/components/ui/button";
import { UNSUBSCRIBABLE, type UnsubscribableKind } from "@/lib/email/compose";

/** E-mails (SPEC §16): one switch per type; the visit reminder is off until switched on. */
export async function EmailSettings({ values }: { values: Record<UnsubscribableKind, boolean> }) {
  const t = await getTranslations("MyFiche.emails");
  return (
    <form action={updateEmailPreferencesAction} className="space-y-3">
      <fieldset className="space-y-1">
        <legend className="font-semibold">{t("title")}</legend>
        {UNSUBSCRIBABLE.map((kind) => (
          <label key={kind} className="flex min-h-11 items-center gap-3">
            <input type="checkbox" name={kind} defaultChecked={values[kind]} className="size-5" />
            {t(kind)}
          </label>
        ))}
      </fieldset>
      <p className="text-grey text-sm">{t("hint")}</p>
      <Button type="submit" variant="secondary">
        {t("save")}
      </Button>
    </form>
  );
}
