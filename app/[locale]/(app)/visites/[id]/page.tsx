import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { VisitRoom } from "@/components/parloir/visit-room";
import { accentForGender } from "@/lib/accent";
import {
  joinVisit,
  loadMessages,
  loadReadState,
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

/** Parloir · Cabine n° (SPEC §7 ter): opening this page marks the member present. */
export default async function VisitPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, userId, profile } = await requireRole();
  const visit = await joinVisit(supabase, id);
  if (!visit) notFound();
  const [messages, readState, tz, pseudo] = await Promise.all([
    visit.conversation_id ? loadMessages(supabase, visit.conversation_id) : Promise.resolve([]),
    visit.conversation_id
      ? loadReadState(supabase, visit.conversation_id)
      : Promise.resolve({ myReadId: 0, otherReadId: 0 }),
    memberTimezone(supabase, userId),
    myPseudo(supabase, userId),
    supabase.rpc("mark_notifications_read", {
      p_types: [
        "visit_starting",
        "visit_reminder_1h",
        "visit_no_show",
        "visit_released",
        "visit_closed",
      ],
    }),
  ]);
  if (visit.conversation_id) await markRendered(supabase, visit.conversation_id, messages);
  return (
    <VisitRoom
      initial={visit}
      messages={messages}
      readState={readState}
      me={{ pseudo, accent: accentForGender(profile.gender) }}
      tz={tz}
    />
  );
}
