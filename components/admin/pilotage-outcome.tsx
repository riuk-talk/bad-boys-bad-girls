import { getTranslations } from "next-intl/server";
import { isPilotageError } from "@/lib/pilotage";

/** The outcome of the last change (?error=… or ?done=1), read aloud. */
export async function PilotageOutcome({ error, done }: { error?: string; done?: string }) {
  const t = await getTranslations("Admin.pilotage");
  if (error) {
    return (
      <p role="alert" className="text-red-bright font-medium">
        {t(`errors.${isPilotageError(error) ? error : "generic"}`)}
      </p>
    );
  }
  return done ? (
    <p role="status" className="text-green-bright font-medium">
      {t("done")}
    </p>
  ) : null;
}
