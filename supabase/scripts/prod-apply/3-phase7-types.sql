-- UTILISÉ LE 2026-11-04, DEVENU INUTILE : phases 6 à 9 déjà en production. Ne pas relancer (voir README.md).
-- bad-boys-prod (hmmobtyherwuhrhymfbk). Script 3 sur 9, à lancer dans l'ordre, dans le SQL Editor.
-- Généré par scripts/build-prod-apply.mjs (ne pas modifier à la main). Une seule transaction :
-- en cas d'erreur, rien n'est appliqué ; relancer le même script après correction.
-- Migrations (texte exact des fichiers, puis leur ligne d'historique) :
--   20261019130000_phase7a_moderation_types.sql
-- Aucun mot destructif.

begin;

-- Garde : la base est à l'étape précédente, et ce script n'a pas déjà été lancé.
do $guard$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261019120000') then
    raise exception 'étape précédente absente (20261019120000) : lancer les scripts dans l''ordre';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version >= '20261019130000') then
    raise exception 'déjà appliqué (20261019130000 ou plus récent présent)';
  end if;
end
$guard$;

-- ===== 20261019130000_phase7a_moderation_types.sql =====
-- Phase 7a: new enum values, in their own migration (a value cannot be used in the transaction
-- that adds it).
alter type public.notification_type add value if not exists 'report_decided';
alter type public.notification_type add value if not exists 'sanction';
alter type public.case_close_reason add value if not exists 'moderation';

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261019130000', 'phase7a_moderation_types', array[$mig$-- Phase 7a: new enum values, in their own migration (a value cannot be used in the transaction
-- that adds it).
alter type public.notification_type add value if not exists 'report_decided';
alter type public.notification_type add value if not exists 'sanction';
alter type public.case_close_reason add value if not exists 'moderation';
$mig$]);

commit;

-- Empreintes (sans les blancs) : colonne attendu = colonne base.
select m.version, m.name, x.expected as attendu, md5(regexp_replace(array_to_string(m.statements, ';'), '\s', '', 'g')) as base
from supabase_migrations.schema_migrations m
join (values
  ('20261019130000', '6ad1eb2a29fd42b0c2b4661356976e2a')
) as x (version, expected) on x.version = m.version
order by m.version;
