import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { OpenParloir } from "@/components/parloir/open-parloir";
import { redirect } from "@/i18n/navigation";
import { accentForGender } from "@/lib/accent";
import { datesSchema } from "@/lib/cavale";
import {
  loadConversation,
  loadMessages,
  loadOtherReadId,
  markRendered,
  myPseudo,
} from "@/lib/relations/parloir";
import { memberTimezone } from "@/lib/relations/schedule";
import { requireRole } from "@/lib/relations/server";

type Props = { params: Promise<{ locale: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Relations.parloir" });
  return { title: t("metaTitle") };
}

/** Le Parloir sans horaire (Permis permanent, SPEC §13). */
export default async function OpenParloirPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, userId, locale, profile } = await requireRole();
  const conversation = await loadConversation(supabase, id);
  if (!conversation) notFound();
  // A conversation still in its visit is read from the visit screen.
  if (conversation.status === "visiting") return redirect({ href: "/visites", locale });
  const [messages, otherReadId, pseudo, tz, { data: dates }] = await Promise.all([
    loadMessages(supabase, id),
    loadOtherReadId(supabase, id),
    myPseudo(supabase, userId),
    memberTimezone(supabase, userId),
    supabase.rpc("get_dates", { p_conversation: id }),
    supabase.rpc("mark_notifications_read", {
      p_types: [
        "message_received",
        "date_proposed",
        "date_accepted",
        "date_countered",
        "date_cancelled",
      ],
    }),
  ]);
  await markRendered(supabase, id, messages);
  const parsedDates = datesSchema.safeParse(dates);
  return (
    <OpenParloir
      conversation={conversation}
      messages={messages}
      otherReadId={otherReadId}
      dates={parsedDates.success ? parsedDates.data : null}
      tz={tz}
      me={{ pseudo, accent: accentForGender(profile.gender) }}
    />
  );
}
