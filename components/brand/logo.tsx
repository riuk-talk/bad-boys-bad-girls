import { cn } from "@/lib/cn";

const LETTER =
  "M0 0H62C88 0 98 16 98 34C98 48 91 58 80 63C94 68 102 80 102 98C102 124 87 140 60 140H0ZM28 24V52H55C65 52 70 46 70 38C70 30 65 24 55 24ZM28 76V116H59C70 116 75 108 75 96C75 84 70 76 59 76Z";

/** Flat monogram (CLAUDE.md): mirrored crowned gold B + red B with horns and devil tail. */
export function Logo({ label, className }: { label?: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 280 210"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("h-auto", className)}
    >
      <g fill="#D4A437">
        <path fillRule="evenodd" d={LETTER} transform="translate(136 56) scale(-1 1)" />
        <path d="M44 50 39 16 59 32 77 8 95 32 115 16 110 50Z" />
        <circle cx="39" cy="14" r="4.5" />
        <circle cx="77" cy="6" r="4.5" />
        <circle cx="115" cy="14" r="4.5" />
      </g>
      <g fill="#E0233F">
        <path fillRule="evenodd" d={LETTER} transform="translate(140 56)" />
        <path d="M154 58C147 44 146 26 152 8C157 26 165 41 176 54Z" />
        <path d="M228 58C235 44 236 26 230 8C225 26 217 41 206 54Z" />
        <path
          d="M238 174C248 198 266 194 268 172"
          fill="none"
          stroke="#E0233F"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path d="M259 176 272 152 279 178Z" />
      </g>
    </svg>
  );
}
