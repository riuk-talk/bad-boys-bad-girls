import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/env";
import { INDEXABLE_PATHS } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return INDEXABLE_PATHS.map((path) => {
    const fr = `${SITE_URL}${path === "/" ? "" : path}`;
    const en = `${SITE_URL}/en${path === "/" ? "" : path}`;
    return { url: fr, alternates: { languages: { fr, en } } };
  });
}
