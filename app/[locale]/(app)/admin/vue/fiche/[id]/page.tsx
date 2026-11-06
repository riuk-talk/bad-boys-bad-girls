import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { FicheShow } from "@/components/relations/fiche-show";
import { requireMember } from "@/lib/auth/user";
import { publicPhotoUrl } from "@/lib/relations/server";
import { ficheSchema } from "@/lib/relations/types";

type Props = { params: Promise<{ locale: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "GreffeView" });
  return { title: t("ficheTitle") };
}

/**
 * A Fiche in full as the Greffe (10a): the 3 poses, the placard, its back with the Casier, as a
 * Visitor sees it, but without betting or asking (the « Voir ma Fiche » display). The opening is
 * logged by admin_view_fiche (which admin, which Fiche, when); nothing else is written, no « seen »
 * of the Promenade, no notification. The true charge is never in the data.
 */
export default async function GreffeFichePage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const member = await requireMember();
  const t = await getTranslations("GreffeView");
  const { data, error } = await member.supabase.rpc("admin_view_fiche", { p_bad: id });
  if (error || !data) notFound();
  const parsed = ficheSchema.safeParse(data);
  if (!parsed.success) notFound();
  const fiche = parsed.data;
  const photos: Record<number, { url: string; cutout: boolean; waived: boolean } | null> = {};
  for (const photo of fiche.photos) {
    const url = publicPhotoUrl(member.supabase, photo.large);
    photos[photo.position] = url
      ? { url, cutout: photo.cutout === true, waived: photo.waived === true }
      : null;
  }
  return (
    <div className="mx-auto w-full max-w-3xl">
      <FicheShow
        fiche={fiche}
        photos={photos}
        action={{ kind: "self" }}
        souffleur={null}
        status={t("ficheStatus")}
        viewerAccent="cream"
        back={
          <LocalizedLink
            href="/admin/vue"
            prefetch={false}
            className="text-cream hover:text-accent inline-flex min-h-11 items-center gap-1 px-2 text-sm font-semibold"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {t("back")}
          </LocalizedLink>
        }
        safety={null}
      />
    </div>
  );
}
