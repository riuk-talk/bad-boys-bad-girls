import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { parseDashboard, TODO_HREF, type Figure } from "@/lib/admin/dashboard";
import { requireMember } from "@/lib/auth/user";

type Props = { params: Promise<{ locale: string }> };

const POSITION_KEYS = ["face", "left", "right"] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "AdminDashboard" });
  return { title: t("title") };
}

/**
 * Le tableau de bord de /admin (10c): real figures only (admin_dashboard, is_admin()), a figure
 * the database does not give shows « — »; then the 10 oldest items waiting, with their page.
 */
export default async function AdminDashboardPage() {
  const member = await requireMember();
  const t = await getTranslations("AdminDashboard");
  const admin = await getTranslations("Admin");
  const greffe = await getTranslations("Greffe");
  const format = await getFormatter();
  const { data, error } = await member.supabase.rpc("admin_dashboard");
  if (error) notFound();
  const d = parseDashboard(data);
  const n = (value: Figure) => (value === null ? t("none") : format.number(value));

  const cards: { key: string; values: { label: string; value: Figure }[]; href?: string }[] = [
    {
      key: "bads",
      values: [
        { label: t("badsRegistered"), value: d.bads_registered },
        { label: t("badsComplete"), value: d.bads_complete },
        { label: t("badsThreePhotos"), value: d.bads_three_photos },
        { label: t("badsVisible"), value: d.bads_visible },
      ],
      href: "/admin/membres?role=bad",
    },
    {
      key: "visitors",
      values: [
        { label: t("visitorsRegistered"), value: d.visitors_registered },
        { label: t("visitorsComplete"), value: d.visitors_complete },
      ],
      href: "/admin/membres?role=visitor",
    },
    {
      key: "blocked",
      values: [{ label: t("blockedLabel"), value: d.dossiers_blocked }],
      href: "/admin/membres?bloques=1",
    },
    {
      key: "photos",
      values: [{ label: t("waiting"), value: d.photos_pending }],
      href: "/admin/greffe",
    },
    {
      key: "reports",
      values: [{ label: t("open"), value: d.reports_open }],
      href: "/admin/signalements",
    },
    { key: "flags", values: [{ label: t("waiting"), value: d.flags_open }], href: "/admin/textes" },
    {
      key: "zones",
      values: [
        { label: t("zonesOpen"), value: d.zones_open },
        { label: t("zonesWaitlist"), value: d.zones_waitlist },
      ],
      href: "/admin/quartiers",
    },
    {
      key: "emails",
      values: [
        { label: t("sentToday"), value: d.emails_sent_today },
        { label: t("appQuota"), value: d.emails_app_quota },
      ],
    },
    { key: "push", values: [{ label: t("queued"), value: d.push_queued }] },
  ];

  return (
    <div className="space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("lead")}</p>
      </div>

      <section aria-labelledby="figures-title" className="space-y-3">
        <h2 id="figures-title" className="sr-only">
          {t("figures")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <li
              key={card.key}
              className="border-line bg-ink-2 flex flex-col gap-3 rounded-[var(--radius-card)] border p-4"
            >
              <h3 className="text-grey text-xs font-bold tracking-[0.12em] uppercase">
                {card.href ? (
                  <Link
                    href={card.href}
                    prefetch={false}
                    className="hover:text-cream underline-offset-4 hover:underline"
                  >
                    {t(`cards.${card.key}`)}
                  </Link>
                ) : (
                  t(`cards.${card.key}`)
                )}
              </h3>
              <dl className="flex flex-wrap gap-x-6 gap-y-2">
                {card.values.map((value) => (
                  <div key={value.label} className="flex flex-col">
                    <dt className="text-cream/85 order-2 text-sm">{value.label}</dt>
                    <dd className="font-display order-1 text-3xl">{n(value.value)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="todo-title" className="space-y-3">
        <h2 id="todo-title" className="font-display text-2xl tracking-wide uppercase">
          {t("todo")}
        </h2>
        {d.todo.length === 0 ? <p className="text-grey">{t("todoEmpty")}</p> : null}
        <ul className="divide-line divide-y">
          {d.todo.map((item, index) => {
            const detail =
              item.kind === "photo"
                ? (() => {
                    const position = Number(item.detail);
                    const key = POSITION_KEYS[position];
                    return key
                      ? greffe(`positions.${key}`)
                      : greffe("positions.extra", { number: position + 1 });
                  })()
                : item.kind === "report"
                  ? admin(`categories.${item.detail as "other"}`)
                  : admin(`sources.${item.detail as "pseudo"}`);
            return (
              <li
                key={`${item.kind}-${index}`}
                className="flex flex-wrap items-baseline gap-x-3 py-3"
              >
                <Link
                  href={TODO_HREF[item.kind]}
                  prefetch={false}
                  className="font-semibold underline underline-offset-4"
                >
                  {t(`kinds.${item.kind}`)}
                </Link>
                <span className="text-cream/85 text-sm">
                  {item.pseudo ?? admin("noPseudo")} · {detail}
                </span>
                <span className="text-grey text-sm">
                  {t("since", {
                    date: format.dateTime(new Date(item.created_at), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
