/** The perforated circle of the visiting-room glass (PARCOURS-DESIGN §5), purely decorative. */
export function Hygiaphone() {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className="text-grey size-7 shrink-0">
      <circle cx="14" cy="14" r="12.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {[
        [14, 7],
        [9, 10],
        [19, 10],
        [14, 14],
        [9, 18],
        [19, 18],
        [14, 21],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.4" fill="currentColor" />
      ))}
    </svg>
  );
}
