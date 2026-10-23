import { cn } from "@/lib/cn";

/**
 * Where the placard of the Fiche will stand on a photo (FichePancarte.dc.html): it covers about
 * the bottom 30 %, so the face and shoulders must be in the frame above it. Drawn over an empty
 * photo slot; the rule itself is also in the règlement du Greffe, for screen readers.
 */
export function FramingGuide({ label, placard }: { label?: string; placard: string }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-x-[8%] top-[5%] bottom-[33%] rounded-sm border-2 border-dashed border-[#f2e8d5]/70">
        {label ? (
          <span className="absolute inset-x-1 top-1 text-center text-[10px] leading-tight font-bold text-[#f2e8d5]">
            {label}
          </span>
        ) : null}
      </div>
      <div className="placard-board absolute inset-x-[10%] top-[70%] bottom-[3%] flex items-center justify-center opacity-80">
        <span className="placard-letters text-[9px] text-[#c9c3b8]">{placard}</span>
      </div>
    </div>
  );
}

/** The placard in front of the bottom of a photo preview: decorative, as on the Fiche. */
export function PlacardPreview({ title, className }: { title: string; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-x-[9%] top-[70%] bottom-[3%]", className)}
    >
      <div className="flex h-0 justify-between px-[22%]">
        <span className="-mt-3 h-3 w-[2px] bg-[#8e8e94]" />
        <span className="-mt-3 h-3 w-[2px] bg-[#8e8e94]" />
      </div>
      <div className="placard-board placard-letters flex h-full flex-col gap-1 px-2 py-1.5">
        <span className="text-[9px] tracking-[0.2em] text-[#c9c3b8]">{title}</span>
        <span className="h-2 w-3/5 rounded-[1px] bg-[#f4f1ea]/70" />
        <span className="h-1.5 w-4/5 rounded-[1px] bg-[#f4f1ea]/40" />
      </div>
    </div>
  );
}
