/**
 * Truncated client IP for the consent log (SPEC §10): IPv4 → /24, IPv6 → /48.
 * Reads the first address of x-forwarded-for (set by Vercel's edge, not by the browser).
 */
export function truncateIp(raw: string | null | undefined): string | null {
  const ip = raw?.split(",")[0]?.trim();
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const octets = v4.slice(1, 4).map(Number);
    return octets.every((n) => n <= 255) ? `${octets.join(".")}.0` : null;
  }
  if (ip.includes(":") && /^[0-9a-fA-F:]+$/.test(ip)) {
    const [head = "", tail = ""] = ip.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const groups = ip.includes("::")
      ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
      : left;
    if (groups.length !== 8) return null;
    return `${groups
      .slice(0, 3)
      .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""))
      .join(":")}::`;
  }
  return null;
}
