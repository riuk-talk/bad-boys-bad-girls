import { useTranslations } from "next-intl";
import { DocumentPage, DocumentSection } from "./document-page";

type Section = { title: string; paragraphs: string[] };

export function LegalDocument({ document }: { document: "terms" | "privacy" | "notice" }) {
  const t = useTranslations("Legal");
  const sections = t.raw(`${document}.sections`) as Section[];
  return (
    <DocumentPage title={t(`${document}.title`)} banner={t("draftBanner")}>
      {sections.map((section) => (
        <DocumentSection key={section.title} title={section.title}>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </DocumentSection>
      ))}
    </DocumentPage>
  );
}
