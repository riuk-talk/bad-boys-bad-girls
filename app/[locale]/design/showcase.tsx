"use client";

import { Scale, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { FicheCard } from "@/components/brand/fiche-card";
import { Logo } from "@/components/brand/logo";
import { Stamp } from "@/components/brand/stamp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { FicheCardSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-line/60 space-y-4 border-t pt-8">
      <h2 className="font-display text-3xl tracking-wide uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function DesignShowcase() {
  const t = useTranslations("Design");
  const common = useTranslations("Common");
  const selectT = useTranslations("Components.select");
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [stampKey, setStampKey] = useState(0);
  const cities = t.raw("cities") as string[];

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-10 sm:px-6">
      <header className="flex items-center gap-4">
        <Logo label={common("brand")} className="w-24" />
        <div>
          <h1 className="font-display text-4xl tracking-wide uppercase">{t("title")}</h1>
          <p className="text-grey">{t("lead")}</p>
        </div>
      </header>

      <Block title={t("buttons")}>
        <div className="flex flex-wrap gap-3">
          <Button>{t("primary")}</Button>
          <Button variant="secondary">{t("secondary")}</Button>
          <Button variant="ghost">{t("ghost")}</Button>
          <Button variant="danger">{t("danger")}</Button>
          <Button disabled>{t("disabled")}</Button>
        </div>
      </Block>

      <Block title={t("fields")}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Input id="demo-pseudo" label={t("pseudo")} hint={t("pseudoHint")} />
          <Input id="demo-pseudo-error" label={t("pseudo")} error={t("pseudoError")} />
          <Select
            id="demo-city"
            label={t("city")}
            placeholder={selectT("placeholder")}
            options={cities.map((city) => ({ value: city, label: city }))}
          />
          <Checkbox id="demo-consent" label={t("consent")} />
        </div>
      </Block>

      <Block title={t("badges")}>
        <div className="flex flex-wrap gap-3">
          <Badge tone="gold" icon={<Scale aria-hidden="true" className="size-4" />}>
            {t("badgeOpen")}
          </Badge>
          <Badge tone="red">{t("badgeFull")}</Badge>
        </div>
      </Block>

      <Block title={t("stamps")}>
        <div key={stampKey} className="flex flex-wrap items-center gap-8 overflow-x-clip py-4">
          <Stamp kind="guilty" animated />
          <Stamp kind="released" animated tilt={6} />
          <Stamp kind="dismissed" animated tilt={-4} />
          <Stamp kind="goodConduct" animated tilt={12} />
          <Stamp kind="permit" animated tilt={-6} />
          <Stamp kind="visitAccepted" animated tilt={5} />
          <Stamp kind="cleanRecord" animated tilt={-10} />
        </div>
        <Button variant="secondary" onClick={() => setStampKey((key) => key + 1)}>
          {t("replay")}
        </Button>
      </Block>

      <Block title={t("fiche")}>
        <FicheCard
          className="max-w-sm lg:max-w-none"
          data={{
            id: "00000000-0000-4000-8000-000000000427",
            pseudo: t("ficheSamplePseudo"),
            age: 34,
            city: t("ficheSampleCity"),
            signs: t.raw("ficheSampleSigns") as string[],
            charges: t.raw("ficheSampleCharges") as string[],
            bio: t("ficheSampleBio"),
            goodConduct: true,
          }}
        />
      </Block>

      <Block title={t("skeletons")}>
        <FicheCardSkeleton label={common("loading")} />
      </Block>

      <Block title={t("empty")}>
        <EmptyState
          icon={<Search className="size-10" />}
          title={t("emptyTitle")}
          body={t("emptyBody")}
        />
      </Block>

      <Block title={t("modal")}>
        <Button onClick={() => setModalOpen(true)}>{t("openModal")}</Button>
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t("modalTitle")}>
          <p>{t("modalBody")}</p>
        </Modal>
      </Block>

      <Block title={t("toast")}>
        <Button onClick={() => toast.show(t("toastMessage"), "success")}>{t("showToast")}</Button>
      </Block>
    </div>
  );
}
