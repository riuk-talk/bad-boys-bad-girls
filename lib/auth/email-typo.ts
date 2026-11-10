/**
 * A mistyped e-mail at sign-up (10d, a real case in production: « …@gmail.comj », never
 * confirmed). A warning only, never a refusal: the address may be right. Two cases:
 *  - the domain looks like a common one mistyped (gmail.comj, hotmial.com, gmail.fr…): a
 *    suggestion « Tu voulais dire …@gmail.com ? »;
 *  - the extension is not a known one: a warning without suggestion.
 */
export const COMMON_DOMAINS = [
  "gmail.com",
  "hotmail.com",
  "hotmail.fr",
  "outlook.com",
  "outlook.fr",
  "live.com",
  "live.fr",
  "msn.com",
  "yahoo.com",
  "yahoo.fr",
  "icloud.com",
  "me.com",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "neuf.fr",
  "laposte.net",
  "bbox.fr",
  "gmx.fr",
  "gmx.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
] as const;

/** Domains often typed for a common one that has no such address (gmail has no « .fr »). */
const KNOWN_SLIPS: Record<string, string> = {
  "gmail.fr": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "icloud.fr": "icloud.com",
  "orange.com": "orange.fr",
  "laposte.fr": "laposte.net",
  "wanadoo.com": "wanadoo.fr",
};

/** The extensions accepted without a warning (the last part of the domain). */
const KNOWN_TLDS = new Set([
  "com", "fr", "net", "org", "eu", "be", "ch", "lu", "mc", "ca", "re", "gp", "mq", "gf", "yt",
  "pf", "nc", "pm", "bl", "mf", "wf", "tf", "de", "es", "it", "pt", "nl", "uk", "ie", "at", "pl",
  "se", "dk", "no", "fi", "cz", "gr", "ro", "hu", "ma", "dz", "tn", "sn", "ci", "cm", "us", "edu",
  "gov", "info", "biz", "io", "me", "co", "app", "dev", "tech", "online", "email", "pro", "name",
  "xyz", "tv", "cc", "paris", "bzh", "corsica", "alsace",
]); // prettier-ignore

export type EmailWarning = { kind: "suggestion"; email: string } | { kind: "unknown_tld" };

/** Edit distance (insertions, deletions, substitutions, swaps of two neighbours). */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, rows[i - 2]![j - 2]! + 1);
      }
      rows[i]![j] = value;
    }
  }
  return rows[a.length]![b.length]!;
}

/** The common domain this one looks like a slip of, or null. */
function nearDomain(domain: string): string | null {
  if ((COMMON_DOMAINS as readonly string[]).includes(domain)) return null;
  if (KNOWN_SLIPS[domain]) return KNOWN_SLIPS[domain];
  // A common domain with a few characters added at the end (gmail.comj, hotmail.fr.).
  const extended = COMMON_DOMAINS.find(
    (common) => domain.startsWith(common) && domain.length - common.length <= 2,
  );
  if (extended) return extended;
  // A slip in the name, same extension (hotmial.com); any extension when it is not a known one.
  const tld = domain.split(".").at(-1) ?? "";
  const candidates = KNOWN_TLDS.has(tld)
    ? COMMON_DOMAINS.filter((common) => common.endsWith(`.${tld}`))
    : COMMON_DOMAINS;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const common of candidates) {
    const d = distance(domain, common);
    if (d < bestDistance) {
      best = common;
      bestDistance = d;
    }
  }
  // At most 2 slips, and never on a short domain (a real small provider is not a typo).
  return best && bestDistance <= (domain.length >= 8 ? 2 : 1) ? best : null;
}

/** The warning for this address, or null when it looks fine (or is not an address at all). */
export function emailWarning(value: string): EmailWarning | null {
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes(".")) return null;
  const near = nearDomain(domain);
  if (near) return { kind: "suggestion", email: `${local}@${near}` };
  const tld = domain.split(".").at(-1) ?? "";
  if (!KNOWN_TLDS.has(tld)) return { kind: "unknown_tld" };
  return null;
}
