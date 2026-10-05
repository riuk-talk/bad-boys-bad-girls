import { getTranslations } from "next-intl/server";
import { markNoticesReadAction } from "@/app/[locale]/(app)/ma-fiche/actions";
import { Stamp } from "@/components/brand/stamp";
import { Button } from "@/components/ui/button";

export type Notice = {
  id: number;
  type: string;
  payload: { photo_position?: number; approved?: boolean; reason?: string | null };
};

const POSE_KEYS: Record<number, "face" | "left" | "right"> = { 0: "face", 1: "left", 2: "right" };

/** In-app notifications of the Greffe (one per photo decision; « PERMIS DÉLIVRÉ » for a Visitor). */
export async function Notices({ notices }: { notices: Notice[] }) {
  if (notices.length === 0) return null;
  const t = await getTranslations("MyFiche.notices");
  const reasons = await getTranslations("Greffe.reasons");
  const poses = await getTranslations("Onboarding.poses");
  return (
    <section
      aria-labelledby="notices-title"
      className="border-accent/60 space-y-3 rounded-lg border p-4"
    >
      <h2 id="notices-title" className="font-display text-xl tracking-wide uppercase">
        {t("title")}
      </h2>
      <ul className="space-y-2">
        {notices.map((notice) => {
          if (notice.type === "permit_granted") {
            return (
              <li key={notice.id} className="flex items-center gap-3">
                <Stamp kind="permit" size="sm" />
                <span>{t("permitGranted")}</span>
              </li>
            );
          }
          const position = notice.payload.photo_position ?? 0;
          const photo =
            position in POSE_KEYS
              ? poses(POSE_KEYS[position]!)
              : t("photoNumber", { number: position + 1 });
          return (
            <li key={notice.id}>
              {notice.payload.approved
                ? t("approved", { photo })
                : t("rejected", {
                    photo,
                    reason: reasons((notice.payload.reason ?? "other") as "other"),
                  })}
            </li>
          );
        })}
      </ul>
      <form action={markNoticesReadAction}>
        <Button type="submit" variant="secondary">
          {t("dismiss")}
        </Button>
      </form>
    </section>
  );
}
