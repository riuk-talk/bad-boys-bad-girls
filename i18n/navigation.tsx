import type { ComponentProps } from "react";
import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

const navigation = createNavigation(routing);

export const { redirect, usePathname, useRouter, getPathname } = navigation;

/**
 * The site's link (locale kept). Never prefetched by default (10h): every page is rendered on
 * demand and has no loading boundary, so a prefetch brought almost nothing, but each page shown
 * started a burst of requests (its tabs and shortcuts), still in flight when the member, or a
 * test, went elsewhere at once; WebKit then sometimes failed that navigation (« internal error »).
 * A link that needs it may still ask (prefetch).
 */
export function Link({ prefetch = false, ...props }: ComponentProps<typeof navigation.Link>) {
  return <navigation.Link prefetch={prefetch} {...props} />;
}
