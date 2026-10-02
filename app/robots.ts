import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/env";
import { INDEXABLE_PATHS } from "@/lib/seo";

// Only the landing, legal pages and the Charter may be crawled (SPEC §10, decision 14).
export default function robots(): MetadataRoute.Robots {
  const allowed = INDEXABLE_PATHS.flatMap((path) =>
    path === "/" ? ["/$", "/en$"] : [`${path}$`, `/en${path}$`],
  );
  return {
    rules: [{ userAgent: "*", allow: allowed, disallow: "/" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
