import { cn } from "@/lib/cn";

/**
 * A member's photo on the height chart (owner's decision 2026-10-23, version B). A cut-out photo
 * (transparent background, `cutout`) stands in front of the fixed wall of the site; a photo kept
 * as it is gets the same graduations drawn over it (version A, the fallback). Used wherever a
 * photo is shown in full — the Fiche, the Permis, the Greffe, the upload previews — so that the
 * Greffe sees exactly what the members will see.
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
        className={cn(
          "absolute inset-0 size-full",
          cutout ? "object-contain object-bottom" : "object-cover",
        )}
      />
      {cutout ? null : (
        <div aria-hidden="true" className="mugshot-lines pointer-events-none absolute inset-0" />
      )}
    </div>
  );
}
