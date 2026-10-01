import { useTranslations } from "next-intl";
import { DocumentPage, DocumentSection } from "./document-page";

type Section = { title: string; items: string[] };

/** Charter and safety tips: titled sections of bullet points. */
export function ListDocument({
  namespace,
  footnote,
}: {
  namespace: "Charter" | "Safety";
  footnote?: string;
}) {
  const t = useTranslations(namespace);
  const sections = t.raw("sections") as Section[];
  return (
    <DocumentPage title={t("title")} lead={t("lead")}>
      {sections.map((section) => (
        <DocumentSection key={section.title} title={section.title}>
          <ul className="space-y-2">
            {section.items.map((item) => (
              <li key={item} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="bg-red-bright mt-2.5 size-2 shrink-0 rounded-full"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </DocumentSection>
      ))}
      {footnote ? <p className="text-grey text-sm">{footnote}</p> : null}
    </DocumentPage>
  );
}
