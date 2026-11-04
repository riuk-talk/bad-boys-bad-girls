-- UTILISÉ LE 2026-11-04, DEVENU INUTILE : phases 6 à 9 déjà en production. Ne pas relancer (voir README.md).
-- bad-boys-prod (hmmobtyherwuhrhymfbk). Script 1 sur 9, à lancer dans l'ordre, dans le SQL Editor.
-- Généré par scripts/build-prod-apply.mjs (ne pas modifier à la main). Une seule transaction :
-- en cas d'erreur, rien n'est appliqué ; relancer le même script après correction.
-- Migrations (texte exact des fichiers, puis leur ligne d'historique) :
--   20261019100000_phase6a_conversation_reads.sql
--   20261019105900_phase6b_date_cancelled_type.sql
-- Contient un mot destructif (delete, drop ou truncate), dans : phase6a_conversation_reads. L'éditeur demandera une confirmation.

begin;

-- Garde : la base est à l'étape précédente, et ce script n'a pas déjà été lancé.
do $guard$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261018150000') then
    raise exception 'étape précédente absente (20261018150000) : lancer les scripts dans l''ordre';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version >= '20261019100000') then
    raise exception 'déjà appliqué (20261019100000 ou plus récent présent)';
  end if;
end
$guard$;

-- ===== 20261019100000_phase6a_conversation_reads.sql =====
-- Phase 6a: read and unread in the Parloir (SPEC §13). Each member's last message read, per
-- conversation; « Lu » is shown under my last message once the other has read it; the unread
-- counters cover the Parloirs sans horaire (Permis permanent) and are read by polling.
-- No DROP.

alter table public.conversations
  add column bad_read_id bigint not null default 0,
  add column visitor_read_id bigint not null default 0;

-- Marks the conversation read up to a message (never beyond the last one, never backwards).
create function public.mark_conversation_read(p_conversation uuid, p_up_to bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations; last_id bigint;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select coalesce(max(m.id), 0) into last_id from public.messages m where m.conversation_id = c.id;
  if me = c.bad_id then
    update public.conversations set bad_read_id = greatest(bad_read_id, least(coalesce(p_up_to, 0), last_id))
    where id = c.id;
  else
    update public.conversations set visitor_read_id = greatest(visitor_read_id, least(coalesce(p_up_to, 0), last_id))
    where id = c.id;
  end if;
end;
$$;

-- What « Lu » needs: how far each of the two has read.
create function public.get_read_state(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'my_read_id', case when me = c.bad_id then c.bad_read_id else c.visitor_read_id end,
    'other_read_id', case when me = c.bad_id then c.visitor_read_id else c.bad_read_id end);
end;
$$;

-- Unread messages of the other, per Parloir sans horaire of the member.
create function public.get_unread_counts()
returns table (conversation_id uuid, unread integer)
language sql stable security definer set search_path = '' as $$
  select c.id, (select count(*)::integer from public.messages m
                where m.conversation_id = c.id and m.kind = 'text' and m.sender_id is distinct from (select auth.uid())
                  and m.id > case when c.bad_id = (select auth.uid()) then c.bad_read_id else c.visitor_read_id end)
  from public.conversations c
  where (select auth.uid()) in (c.bad_id, c.visitor_id) and c.status = 'open'
    and not public.is_blocked_between(c.bad_id, c.visitor_id)
$$;

revoke execute on function public.mark_conversation_read(uuid, bigint), public.get_read_state(uuid),
  public.get_unread_counts() from public, anon;
grant execute on function public.mark_conversation_read(uuid, bigint), public.get_read_state(uuid),
  public.get_unread_counts() to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261019100000', 'phase6a_conversation_reads', array[$mig$-- Phase 6a: read and unread in the Parloir (SPEC §13). Each member's last message read, per
-- conversation; « Lu » is shown under my last message once the other has read it; the unread
-- counters cover the Parloirs sans horaire (Permis permanent) and are read by polling.
-- No DROP.

alter table public.conversations
  add column bad_read_id bigint not null default 0,
  add column visitor_read_id bigint not null default 0;

-- Marks the conversation read up to a message (never beyond the last one, never backwards).
create function public.mark_conversation_read(p_conversation uuid, p_up_to bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations; last_id bigint;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select coalesce(max(m.id), 0) into last_id from public.messages m where m.conversation_id = c.id;
  if me = c.bad_id then
    update public.conversations set bad_read_id = greatest(bad_read_id, least(coalesce(p_up_to, 0), last_id))
    where id = c.id;
  else
    update public.conversations set visitor_read_id = greatest(visitor_read_id, least(coalesce(p_up_to, 0), last_id))
    where id = c.id;
  end if;
end;
$$;

-- What « Lu » needs: how far each of the two has read.
create function public.get_read_state(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'my_read_id', case when me = c.bad_id then c.bad_read_id else c.visitor_read_id end,
    'other_read_id', case when me = c.bad_id then c.visitor_read_id else c.bad_read_id end);
end;
$$;

-- Unread messages of the other, per Parloir sans horaire of the member.
create function public.get_unread_counts()
returns table (conversation_id uuid, unread integer)
language sql stable security definer set search_path = '' as $$
  select c.id, (select count(*)::integer from public.messages m
                where m.conversation_id = c.id and m.kind = 'text' and m.sender_id is distinct from (select auth.uid())
                  and m.id > case when c.bad_id = (select auth.uid()) then c.bad_read_id else c.visitor_read_id end)
  from public.conversations c
  where (select auth.uid()) in (c.bad_id, c.visitor_id) and c.status = 'open'
    and not public.is_blocked_between(c.bad_id, c.visitor_id)
$$;

revoke execute on function public.mark_conversation_read(uuid, bigint), public.get_read_state(uuid),
  public.get_unread_counts() from public, anon;
grant execute on function public.mark_conversation_read(uuid, bigint), public.get_read_state(uuid),
  public.get_unread_counts() to authenticated;
$mig$]);

-- ===== 20261019105900_phase6b_date_cancelled_type.sql =====
-- Phase 6b: « Cavale annulée » is notified to the other (SPEC §16). Alone in its migration: a new
-- enum value cannot be used in the transaction that adds it (push_path, next migration).
alter type public.notification_type add value if not exists 'date_cancelled';

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261019105900', 'phase6b_date_cancelled_type', array[$mig$-- Phase 6b: « Cavale annulée » is notified to the other (SPEC §16). Alone in its migration: a new
-- enum value cannot be used in the transaction that adds it (push_path, next migration).
alter type public.notification_type add value if not exists 'date_cancelled';
$mig$]);

commit;

-- Empreintes (sans les blancs) : colonne attendu = colonne base.
select m.version, m.name, x.expected as attendu, md5(regexp_replace(array_to_string(m.statements, ';'), '\s', '', 'g')) as base
from supabase_migrations.schema_migrations m
join (values
  ('20261019100000', '77fc702b25824880eceabe05d4790f39'),
  ('20261019105900', '5c9dfabde839cb64fd4bf7480e1faf7f')
) as x (version, expected) on x.version = m.version
order by m.version;
