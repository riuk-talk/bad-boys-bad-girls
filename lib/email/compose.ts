import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

/** The e-mails (SPEC §16): neutral texts (no pseudo, no message), one link into the site. */

export const EMAIL_KINDS = [
  "request_digest",
  "date_accepted",
  "zone_opened",
  "profile_dormant",
  "visit_reminder",
  "permit_granted",
  "onboarding_reminder",
  "moderation_decision",
  "admin_zone_ready",
  "admin_photos_pending",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** Kinds a member can switch off from the e-mail itself (désinscription par type). */
export const UNSUBSCRIBABLE = [
  "request_digest",
  "date_accepted",
  "zone_opened",
  "profile_dormant",
  "visit_reminder",
  "permit_granted",
] as const;
export type UnsubscribableKind = (typeof UNSUBSCRIBABLE)[number];

export function isUnsubscribable(kind: string): kind is UnsubscribableKind {
  return UNSUBSCRIBABLE.some((value) => value === kind);
}

const PATHS: Record<EmailKind, string | null> = {
  request_digest: "/",
  date_accepted: "/visites",
  zone_opened: "/",
  profile_dormant: "/connexion",
  visit_reminder: "/visites",
  permit_granted: "/ma-fiche",
  onboarding_reminder: "/onboarding",
  moderation_decision: null,
  admin_zone_ready: "/admin/quartiers",
  admin_photos_pending: "/admin/greffe",
};

export type Composed = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * One e-mail in the member's language. `detail` is the only variable text: the motive of a ban
 * (sent to the banned member themself) or the name of a quartier (to the admins).
 */
export function composeEmail(
  kind: EmailKind,
  locale: "fr" | "en",
  siteUrl: string,
  options: { detail?: string; unsubscribeUrl?: string } = {},
): Composed {
  const t = createTranslator({ locale, messages: locale === "en" ? en : fr, namespace: "Email" });
  const path = PATHS[kind];
  const link = path ? `${siteUrl}/${locale}${path === "/" ? "" : path}` : null;
  const subject = t(`${kind}.subject`, { detail: options.detail ?? "" });
  const body = t(`${kind}.body`, { detail: options.detail ?? "" });
  const lines = [
    body,
    ...(link ? [`${t("open")} ${link}`] : []),
    "",
    t("signature"),
    ...(options.unsubscribeUrl ? ["", `${t("unsubscribe")} ${options.unsubscribeUrl}`] : []),
  ];
  const html = [
    `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>`,
    link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(t("open"))}</a></p>` : "",
    `<p>${escapeHtml(t("signature"))}</p>`,
    options.unsubscribeUrl
      ? `<p style="font-size:12px"><a href="${escapeHtml(options.unsubscribeUrl)}">${escapeHtml(t("unsubscribe"))}</a></p>`
      : "",
  ].join("");
  return { subject, text: lines.join("\n"), html };
}
