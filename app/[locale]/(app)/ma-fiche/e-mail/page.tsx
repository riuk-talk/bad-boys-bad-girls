import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EmailChange } from "@/components/app/account-security";
import { ButtonLink } from "@/components/ui/button-link";
import { requireMemberArea } from "@/lib/auth/user";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ etat?: string }>;
};

const STATES = ["attente", "change", "lien"] as const;
type LinkState = (typeof STATES)[number];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "AccountSecurity.email" });
  return { title: t("title") };
}

/**
 * Ma fiche › Mon compte › Changer d'e-mail (10j, question 10-22). The address of the account and a
 * change waiting for its links, as Supabase Auth knows them; after a link, where the change is.
 */
export default async function EmailPage({ searchParams }: Props) {
  const { supabase } = await requireMemberArea();
  const t = await getTranslations("AccountSecurity");
  const { etat } = await searchParams;
  const state = STATES.find((value) => value === etat) as LinkState | undefined;
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? "";
  const waiting = data.user?.new_email ?? null;
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("email.title")}</h1>
        <p className="break-words">
          {t.rich("email.currentAddress", {
            strong: () => <strong className="break-all">{email}</strong>,
          })}
        </p>
        <p className="text-cream/85">{t("email.lead")}</p>
      </div>
      {state ? (
        <p
          role={state === "lien" ? "alert" : "status"}
          className="border-line bg-ink-2 rounded-md border p-4 font-semibold"
        >
          {t(`email.state.${state}`)}
        </p>
      ) : null}
      {waiting ? (
        <p className="text-gold break-words">
          {t.rich("email.pending", {
            strong: () => <strong className="break-all">{waiting}</strong>,
          })}
        </p>
      ) : null}
      <EmailChange />
      <ButtonLink href="/ma-fiche" variant="ghost">
        {t("back")}
      </ButtonLink>
    </div>
  );
}
