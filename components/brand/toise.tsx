import { cn } from "@/lib/cn";

const MARKS = [200, 190, 180, 170, 160, 150, 140, 130, 120];

/** Height-chart background (lines 200 → 120) behind the ID photo (SPEC §5). Decorative. */
export function Toise({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 400 500"
      preserveAspectRatio="none"
      className={cn("absolute inset-0 size-full", className)}
    >
      <rect width="400" height="500" fill="#222227" />
      {MARKS.map((mark, index) => {
        const y = 30 + index * 55;
        return (
          <g key={mark}>
            <line
              x1="0"
              x2="400"
              y1={y}
              y2={y}
              stroke="#F2E8D5"
              strokeOpacity="0.28"
              strokeWidth="2"
            />
            <line
              x1="0"
              x2="400"
              y1={y + 27}
              y2={y + 27}
              stroke="#F2E8D5"
              strokeOpacity="0.1"
              strokeWidth="1"
            />
            <text
              x="10"
              y={y - 6}
              fill="#F2E8D5"
              fillOpacity="0.55"
              fontSize="16"
              fontFamily="monospace"
            >
              {mark}
            </text>
            <text
              x="390"
              y={y - 6}
              fill="#F2E8D5"
              fillOpacity="0.55"
              fontSize="16"
              fontFamily="monospace"
              textAnchor="end"
            >
              {mark}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
