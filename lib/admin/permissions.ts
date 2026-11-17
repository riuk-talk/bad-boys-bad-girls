/**
 * The administration permissions (10f), as admin_permissions lists them in the database: one per
 * area of /admin, to read or to act. The database decides (has_admin_permission, with the second
 * factor); the application only hides what it would refuse. team.manage belongs to the super
 * admin alone: it is never one of a role's boxes.
 */
export const ADMIN_PERMISSIONS = [
  "dashboard.view",
  "members.view",
  "members.detail",
  "vue_visiteur.view",
  "greffe.decide",
  "reports.decide",
  "flags.decide",
  "texts.edit",
  "keywords.edit",
  "sanctions.apply",
  "birthdate.decide",
  "zones.edit",
  "questions.edit",
  "signs.edit",
  "performance.view",
  "history.view",
  "team.manage",
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** The boxes a role may have (all but team.manage). */
export const ROLE_PERMISSIONS = ADMIN_PERMISSIONS.filter((p) => p !== "team.manage");

export function isAdminPermission(value: unknown): value is AdminPermission {
  return typeof value === "string" && (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

/** The permissions from the database; anything unknown is left out (never a made-up right). */
export function parsePermissions(value: unknown): AdminPermission[] {
  return Array.isArray(value) ? value.filter(isAdminPermission) : [];
}
