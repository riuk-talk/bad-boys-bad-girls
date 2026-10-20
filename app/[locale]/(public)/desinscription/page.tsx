import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import * as z from "zod/mini";
import { Button } from "@/components/ui/button";
import { UNSUBSCRIBABLE } from "@/lib/email/compose";
import { unsubscribeAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ t?: string; k?: string; done?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Unsubscribe" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

const schema = z.object({ t: z.uuid(), k: z.enum(UNSUBSCRIBABLE) });

/** Désinscription par type (SPEC §16): one button, nothing changes until it is pressed. */
export default async function UnsubscribePage({ searchParams }: Props) {
  const t = await getTranslations("Unsubscribe");
  const query = await searchParams;
  const parsed = schema.safeParse({ t: query.t, k: query.k });
  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
      {query.done === "ok" ? (
        <p role="status">{t("done")}</p>
      ) : query.done === "error" ? (
        <p role="alert" className="text-red-bright">
          {t("error")}
        </p>
      ) : parsed.success ? (
        <form action={unsubscribeAction} className="space-y-4">
          <input type="hidden" name="t" value={parsed.data.t} />
          <input type="hidden" name="k" value={parsed.data.k} />
          <p>{t("question", { kind: t(`kinds.${parsed.data.k}`) })}</p>
          <Button type="submit">{t("confirm")}</Button>
        </form>
      ) : (
        <p role="alert" className="text-red-bright">
          {t("invalid")}
        </p>
      )}
      <p className="text-grey text-sm">{t("settings")}</p>
    </div>
  );
}
