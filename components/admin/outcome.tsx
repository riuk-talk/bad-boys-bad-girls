import { getTranslations } from "next-intl/server";
import { isModerationError } from "@/lib/moderation";

/** The outcome of the last decision (?error=… or ?done=1), read aloud. */
export async function Outcome({ error, done }: { error?: string; done?: string }) {
  const t = await getTranslations("Admin");
  if (error) {
    return (
      <p role="alert" className="text-red-bright font-medium">
        {t(`errors.${isModerationError(error) ? error : "generic"}`)}
      </p>
    );
  }
  return done ? (
    <p role="status" className="text-green-bright font-medium">
      {t("done")}
    </p>
  ) : null;
}
