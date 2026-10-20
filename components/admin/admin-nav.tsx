import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

const SECTIONS = [
  "greffe",
  "signalements",
  "textes",
  "membres",
  "historique",
  "quartiers",
  "signes",
  "mots-cles",
  "questions",
  "performance",
] as const;

/** /admin sections (SPEC §15): the Greffe first (photos), then moderation. */
export async function AdminNav() {
  const t = await getTranslations("Admin.nav");
  return (
    <nav aria-label={t("label")} className="border-line border-b">
      <ul className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 sm:px-6">
        {SECTIONS.map((section) => (
          <li key={section}>
            <Link
              href={`/admin/${section}`}
              className="text-cream hover:text-accent inline-flex min-h-11 items-center px-3 text-sm font-semibold whitespace-nowrap"
            >
              {t(section === "mots-cles" ? "keywords" : section)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
