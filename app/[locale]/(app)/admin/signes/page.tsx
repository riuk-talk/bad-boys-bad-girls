import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PilotageOutcome } from "@/components/admin/pilotage-outcome";
import { Button } from "@/components/ui/button";
import { requireAdminPermission } from "@/lib/admin/guard";
import { saveTribeAction } from "../pilotage-actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.tribes" });
  return { title: t("title") };
}

const field = "border-line bg-ink-2 min-h-11 w-full rounded-lg border px-3 py-2";

type Tribe = { id?: number; slug: string; fr: string; en: string; sort: number; active: boolean };

async function TribeForm({ tribe, id }: { tribe: Tribe; id: string }) {
  const t = await getTranslations("Admin.tribes");
  return (
    <form action={saveTribeAction} className="grid items-end gap-3 sm:grid-cols-6">
      {tribe.id ? <input type="hidden" name="tribe" value={tribe.id} /> : null}
      {(
        [
          ["fr", t("fr"), tribe.fr],
          ["en", t("en"), tribe.en],
          ["slug", t("slug"), tribe.slug],
          ["sort", t("sort"), String(tribe.sort)],
        ] as const
      ).map(([name, label, value]) => (
        <div key={name} className="space-y-1 sm:col-span-1">
          <label htmlFor={`${id}-${name}`} className="text-sm font-semibold">
            {label}
          </label>
          <input
            id={`${id}-${name}`}
            name={name}
            defaultValue={value}
            required
            type={name === "sort" ? "number" : "text"}
            className={field}
          />
        </div>
      ))}
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" name="active" defaultChecked={tribe.active} />
        {t("active")}
      </label>
      <Button type="submit" variant="secondary">
        {tribe.id ? t("save") : t("create")}
      </Button>
    </form>
  );
}

/** Signes distinctifs (SPEC §15): labels FR/EN, order, deactivation (never removed). */
export default async function TribesPage({ searchParams }: Props) {
  const member = await requireAdminPermission("signs.edit");
  const t = await getTranslations("Admin.tribes");
  const { error, done } = await searchParams;
  const { data } = await member.supabase.rpc("admin_tribes");
  const tribes = data ?? [];
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("lead")}</p>
        <PilotageOutcome error={error} done={done} />
      </div>
      <ul className="space-y-4">
        {tribes.map((tribe) => (
          <li
            key={tribe.tribe_id}
            className="border-line space-y-2 rounded-lg border bg-[#121214] p-4"
          >
            <p className="text-grey text-sm">{t("members", { count: tribe.members })}</p>
            <TribeForm
              id={`tribe-${tribe.tribe_id}`}
              tribe={{
                id: tribe.tribe_id,
                slug: tribe.slug,
                fr: tribe.label_fr,
                en: tribe.label_en,
                sort: tribe.sort,
                active: tribe.is_active,
              }}
            />
          </li>
        ))}
      </ul>
      <section aria-labelledby="new-tribe" className="space-y-3">
        <h2 id="new-tribe" className="font-display text-2xl uppercase">
          {t("new")}
        </h2>
        <TribeForm id="tribe-new" tribe={{ slug: "", fr: "", en: "", sort: 100, active: true }} />
      </section>
    </div>
  );
}
