import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Outcome } from "@/components/admin/outcome";
import { Button } from "@/components/ui/button";
import { requireAdminPermission } from "@/lib/admin/guard";
import { ROLE_PERMISSIONS } from "@/lib/admin/permissions";
import { deleteRoleAction, grantRoleAction, revokeRoleAction, saveRoleAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin.team" });
  return { title: t("title") };
}

const field = "border-line bg-ink-2 w-full rounded-lg border px-3 py-2 min-h-11";
const permissionKey = (permission: string) => permission.replace(".", "_");

/**
 * Équipe (10f), the super admin only (team.manage): who holds which role, giving, changing and
 * taking back a role (exact e-mail or pseudo), and the roles themselves (name, description, boxes;
 * an empty role can be deleted). The super admin is shown, never touched. Every change is logged.
 */
export default async function TeamPage({ searchParams }: Props) {
  const member = await requireAdminPermission("team.manage");
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const { error, done } = await searchParams;
  const [{ data: team }, { data: roles }] = await Promise.all([
    member.supabase.rpc("admin_team"),
    member.supabase.rpc("admin_roles_list"),
  ]);
  const roleOptions = (roles ?? []).map((role) => ({ id: role.id, name: role.name }));

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-wide uppercase">{t("team.title")}</h1>
        <p className="text-cream/85 max-w-3xl">{t("team.lead")}</p>
        <Outcome error={error} done={done} />
      </div>

      <section aria-labelledby="members-title" className="space-y-3">
        <h2 id="members-title" className="font-display text-2xl uppercase">
          {t("team.membersTitle")}
        </h2>
        <ul className="divide-line divide-y">
          {(team ?? []).map((row) => {
            const who = row.pseudo ? `${row.pseudo} · ${row.email}` : row.email;
            return (
              <li key={row.user_id} className="space-y-2 py-4">
                <p className="font-semibold break-all">{who}</p>
                <p className="text-grey text-sm">
                  {row.is_super_admin ? t("team.superAdmin") : row.role_name}
                  {" · "}
                  {row.has_second_factor ? t("team.mfaOn") : t("team.mfaOff")}
                  {" · "}
                  {t("team.since", {
                    date: format.dateTime(new Date(row.granted_at), { dateStyle: "medium" }),
                  })}
                </p>
                {row.is_super_admin ? null : (
                  <div className="flex flex-wrap items-end gap-3">
                    <form action={grantRoleAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="account" value={row.email} />
                      <label className="space-y-1 text-sm">
                        <span className="font-semibold">{t("team.role")}</span>
                        <select
                          name="role"
                          defaultValue={row.role_id ?? undefined}
                          className={field}
                        >
                          {roleOptions.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button type="submit" variant="secondary">
                        {t("team.change")}
                      </Button>
                    </form>
                    <form action={revokeRoleAction}>
                      <input type="hidden" name="user" value={row.user_id} />
                      <Button type="submit" variant="danger">
                        {t("team.revoke")}
                      </Button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-labelledby="grant-title"
        className="border-line space-y-3 rounded-lg border p-4"
      >
        <h2 id="grant-title" className="font-display text-2xl uppercase">
          {t("team.grantTitle")}
        </h2>
        <p className="text-cream/85 text-sm">{t("team.grantLead")}</p>
        <form
          action={grantRoleAction}
          className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end"
        >
          <label className="space-y-1 text-sm">
            <span className="font-semibold">{t("team.account")}</span>
            <input name="account" required minLength={3} maxLength={254} className={field} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">{t("team.role")}</span>
            <select name="role" className={field}>
              {roleOptions.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">{t("team.grant")}</Button>
        </form>
      </section>

      <section aria-labelledby="roles-title" className="space-y-4">
        <h2 id="roles-title" className="font-display text-2xl uppercase">
          {t("team.rolesTitle")}
        </h2>
        <p className="text-cream/85 text-sm">{t("team.rolesLead")}</p>
        {[...(roles ?? []), null].map((role) => {
          const id = role ? `role-${role.id}` : "role-new";
          return (
            <form
              key={id}
              action={saveRoleAction}
              aria-labelledby={`${id}-title`}
              className="border-line space-y-3 rounded-lg border p-4"
            >
              <h3 id={`${id}-title`} className="font-semibold">
                {role
                  ? t("team.roleHeading", { name: role.name, count: role.members })
                  : t("team.newRole")}
              </h3>
              {role ? <input type="hidden" name="role" value={role.id} /> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-semibold">{t("team.name")}</span>
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={40}
                    defaultValue={role?.name ?? ""}
                    className={field}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-semibold">{t("team.description")}</span>
                  <input
                    name="description"
                    maxLength={200}
                    defaultValue={role?.description ?? ""}
                    className={field}
                  />
                </label>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">{t("team.permissions")}</legend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {ROLE_PERMISSIONS.map((permission) => (
                    <label key={permission} className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="permissions"
                        value={permission}
                        defaultChecked={role?.permissions.includes(permission) ?? false}
                        className="accent-accent size-5"
                      />
                      {t(`permissions.${permissionKey(permission)}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex flex-wrap gap-3">
                <Button type="submit">{role ? t("team.saveRole") : t("team.createRole")}</Button>
                {role && role.members === 0 ? (
                  <Button
                    type="submit"
                    formAction={deleteRoleAction}
                    formNoValidate
                    variant="danger"
                  >
                    {t("team.deleteRole")}
                  </Button>
                ) : null}
              </div>
            </form>
          );
        })}
      </section>
    </div>
  );
}
