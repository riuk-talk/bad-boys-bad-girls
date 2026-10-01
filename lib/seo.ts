/**
 * Routes that search engines may index (SPEC §10, decision 14):
 * landing, legal pages and the Charter. Everything else is noindex.
 * Paths are locale-less (the "en" prefix is stripped before matching).
 */
export const INDEXABLE_PATHS = [
  "/",
  "/charte",
  "/cgu",
  "/confidentialite",
  "/mentions-legales",
] as const;

export function stripLocale(pathname: string): string {
  const stripped = pathname.replace(/^\/en(?=\/|$)/, "");
  return stripped === "" ? "/" : stripped;
}

export function isIndexable(pathname: string): boolean {
  const path = stripLocale(pathname).replace(/\/+$/, "") || "/";
  return (INDEXABLE_PATHS as readonly string[]).includes(path);
}

/** Metadata for an indexable page: index/follow, canonical URL and language alternates. */
export function indexableMetadata(locale: string, path: (typeof INDEXABLE_PATHS)[number]) {
  const localized = (target: string) =>
    target === "fr" ? path : path === "/" ? "/en" : `/en${path}`;
  return {
    robots: { index: true, follow: true },
    alternates: {
      canonical: localized(locale),
      languages: { fr: localized("fr"), en: localized("en"), "x-default": localized("fr") },
    },
  };
}
