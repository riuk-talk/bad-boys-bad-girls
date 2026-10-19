import { getTranslations } from "next-intl/server";
import { tabStateAction } from "@/app/[locale]/(app)/tab-actions";
import { TabBarLinks, type TabLink } from "@/components/app/tab-bar-links";
import type { Role } from "@/lib/onboarding/config";
import type { Database } from "@/lib/supabase/database.types";

type NotificationType = Database["public"]["Enums"]["notification_type"];

/**
 * Bottom navigation (maquettes Promenade, Courrier). Phase 5b adds « Visites » (Tableau des
 * visites) for both roles; the Parloir lives in that tab too (owner, 2026-10-18). Phase 6a: the
 * badges are read again by the client every 60 s, and « Visites » counts the unread messages.
 */
const VISIT_NEWS: readonly NotificationType[] = [
  "slot_chosen",
  "visit_cancelled",
  "visit_reminder_1h",
  "visit_starting",
  "visit_no_show",
  "visit_released",
  "visit_closed",
  "message_received",
  "date_proposed",
  "date_accepted",
  "date_countered",
];

const TABS: Record<Role, readonly TabLink[]> = {
  visitor: [
    { href: "/promenade", key: "promenade", news: ["promenade_open"], counts: false },
    { href: "/decouverte", key: "discover", news: [], counts: false },
    {
      href: "/demandes",
      key: "requests",
      news: ["request_accepted", "request_dismissed", "slots_reproposed", "visit_cancelled"],
      counts: false,
    },
    { href: "/visites", key: "visits", news: VISIT_NEWS, counts: true },
    { href: "/ma-fiche", key: "myPermit", news: [], counts: false },
  ],
  bad: [
    {
      href: "/courrier",
      key: "mailbox",
      news: ["request_received", "slots_declined"],
      counts: false,
    },
    { href: "/visites", key: "visits", news: VISIT_NEWS, counts: true },
    { href: "/ma-fiche", key: "myFiche", news: [], counts: false },
  ],
};

export async function TabBar({ role }: { role: Role }) {
  const [t, initial] = await Promise.all([getTranslations("Relations.tabs"), tabStateAction()]);
  return (
    <nav
      aria-label={t("label")}
      className="border-line/70 bg-ink sticky bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)]"
    >
      <TabBarLinks tabs={TABS[role]} initial={initial} />
    </nav>
  );
}
