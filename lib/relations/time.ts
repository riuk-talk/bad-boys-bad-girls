/** Local time of the launch zones (all in France at launch; launch_zones.timezone defaults to it). */
export const ZONE_TIMEZONE = "Europe/Paris";
export const PROMENADE_HOUR = 21;

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of the time zone from UTC at this instant, in milliseconds. */
function offsetMs(date: Date, timeZone: string) {
  const p = localParts(date, timeZone);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    Math.floor(date.getTime() / 1000) * 1000
  );
}

/** The next opening of the Promenade (21:00 local time), strictly after `now`. */
export function nextPromenadeAt(now: Date, timeZone = ZONE_TIMEZONE): Date {
  const p = localParts(now, timeZone);
  for (const extraDay of [0, 1, 2]) {
    const wallClock = Date.UTC(p.year, p.month - 1, p.day + extraDay, PROMENADE_HOUR, 0, 0);
    // Two passes settle the offset on days when the clocks change.
    let candidate = new Date(wallClock - offsetMs(new Date(wallClock), timeZone));
    candidate = new Date(wallClock - offsetMs(candidate, timeZone));
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return new Date(now.getTime() + 24 * 3600 * 1000);
}

/** Hours and minutes until `target` (rounded down, never negative). */
export function untilParts(now: Date, target: Date) {
  const minutes = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 60000));
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
