"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * A member's photo on the height chart (owner's final decision 2026-10-23: the same wall for
 * everyone). A cut-out photo (transparent background, `cutout`) stands in front of the fixed wall
 * of the site. The graduations drawn over the photo (CSS/SVG) are only a fallback: when a cut-out
 * image does not load, and for an original not cut out yet (waiting for the Greffe, or validated
 * before the decision). Used wherever a photo is shown in full — the Fiche, the Permis, the
 * Greffe, the upload previews — so that the Greffe sees exactly what the members will see.
 */
export function Mugshot({
  src,
  alt,
  cutout,
  className,
  priority = false,
  fill = false,
}: {
  src: string;
  alt: string;
  cutout: boolean;
  className?: string;
  priority?: boolean;
  /** Fills its positioned parent (absolute, inset 0) instead of sizing itself. */
  fill?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const overLines = !cutout || failed;
  return (
    <div
      className={cn(
        "mugshot-wall overflow-hidden",
        fill ? "absolute inset-0" : "relative",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- pre-optimised WebP, signed or blob URLs */}
      <img
        src={src}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        onError={() => setFailed(true)}
        className={cn(
          "absolute inset-0 size-full",
          cutout ? "object-contain object-bottom" : "object-cover",
          failed && "invisible",
        )}
      />
      {overLines ? (
        <div aria-hidden="true" className="mugshot-lines pointer-events-none absolute inset-0" />
      ) : null}
    </div>
  );
}
