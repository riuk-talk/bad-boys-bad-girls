-- bad-boys-prod (hmmobtyherwuhrhymfbk). Script 8 sur 9, à lancer dans l'ordre, dans le SQL Editor.
-- Généré par scripts/build-prod-apply.mjs (ne pas modifier à la main). Une seule transaction :
-- en cas d'erreur, rien n'est appliqué ; relancer le même script après correction.
-- Migrations (texte exact des fichiers, puis leur ligne d'historique) :
--   20261022090000_phase9a_casier_cliches.sql
--   20261022100000_phase9b_parloir_nudge.sql
--   20261022110000_phase9c_recruited_badge.sql
--   20261023090000_photo_cutout.sql
--   20261023120000_photo_cutout_required.sql
-- Aucun mot destructif.

begin;

-- Garde : la base est à l'étape précédente, et ce script n'a pas déjà été lancé.
do $guard$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261020150100') then
    raise exception 'étape précédente absente (20261020150100) : lancer les scripts dans l''ordre';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version >= '20261022090000') then
    raise exception 'déjà appliqué (20261022090000 ou plus récent présent)';
  end if;
end
$guard$;

-- ===== 20261022090000_phase9a_casier_cliches.sql =====
-- Phase 9a [P1]: les clichés déconseillés du Casier (SPEC §6). A list in the database (FR + EN) of
-- generic formulas; the Casier assistant and « Teste ton Casier » advise against them, never block.
-- `needs_detail`: the formula is only a cliché when the line says nothing more (« tapage nocturne »
-- alone). Members read the active list through one function; nobody writes it but migrations.

create table public.casier_cliches (
  id smallint generated always as identity primary key,
  lang text not null check (lang in ('fr', 'en')),
  phrase text not null check (char_length(phrase) between 3 and 60),
  needs_detail boolean not null default false,
  is_active boolean not null default true,
  unique (lang, phrase)
);
alter table public.casier_cliches enable row level security;
revoke all on public.casier_cliches from public, anon, authenticated;

insert into public.casier_cliches (lang, phrase, needs_detail) values
  ('fr', 'vol de cœur', false),
  ('fr', 'excès de charme', false),
  ('fr', 'trop beau', false),
  ('fr', 'trop belle', false),
  ('fr', 'séduction non autorisée', false),
  ('fr', 'briseur de cœur', false),
  ('fr', 'briseuse de cœur', false),
  ('fr', 'coupable d''être moi-même', false),
  ('fr', 'tapage nocturne', true),
  ('fr', 'récidiviste de l''amour', false),
  ('en', 'heart thief', false),
  ('en', 'stealing hearts', false),
  ('en', 'too much charm', false),
  ('en', 'too handsome', false),
  ('en', 'too pretty', false),
  ('en', 'unauthorized seduction', false),
  ('en', 'heartbreaker', false),
  ('en', 'guilty of being myself', false),
  ('en', 'disturbing the peace', true),
  ('en', 'repeat offender of love', false);

-- The active list, both languages (a Casier may be written in either).
create function public.get_casier_cliches()
returns table (phrase text, needs_detail boolean)
language sql stable security definer set search_path = '' as $$
  select c.phrase, c.needs_detail from public.casier_cliches c
  where c.is_active and (select auth.uid()) is not null
  order by c.lang, c.id
$$;
revoke execute on function public.get_casier_cliches() from public, anon, authenticated, service_role;
grant execute on function public.get_casier_cliches() to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022090000', 'phase9a_casier_cliches', array[$mig$-- Phase 9a [P1]: les clichés déconseillés du Casier (SPEC §6). A list in the database (FR + EN) of
-- generic formulas; the Casier assistant and « Teste ton Casier » advise against them, never block.
-- `needs_detail`: the formula is only a cliché when the line says nothing more (« tapage nocturne »
-- alone). Members read the active list through one function; nobody writes it but migrations.

create table public.casier_cliches (
  id smallint generated always as identity primary key,
  lang text not null check (lang in ('fr', 'en')),
  phrase text not null check (char_length(phrase) between 3 and 60),
  needs_detail boolean not null default false,
  is_active boolean not null default true,
  unique (lang, phrase)
);
alter table public.casier_cliches enable row level security;
revoke all on public.casier_cliches from public, anon, authenticated;

insert into public.casier_cliches (lang, phrase, needs_detail) values
  ('fr', 'vol de cœur', false),
  ('fr', 'excès de charme', false),
  ('fr', 'trop beau', false),
  ('fr', 'trop belle', false),
  ('fr', 'séduction non autorisée', false),
  ('fr', 'briseur de cœur', false),
  ('fr', 'briseuse de cœur', false),
  ('fr', 'coupable d''être moi-même', false),
  ('fr', 'tapage nocturne', true),
  ('fr', 'récidiviste de l''amour', false),
  ('en', 'heart thief', false),
  ('en', 'stealing hearts', false),
  ('en', 'too much charm', false),
  ('en', 'too handsome', false),
  ('en', 'too pretty', false),
  ('en', 'unauthorized seduction', false),
  ('en', 'heartbreaker', false),
  ('en', 'guilty of being myself', false),
  ('en', 'disturbing the peace', true),
  ('en', 'repeat offender of love', false);

-- The active list, both languages (a Casier may be written in either).
create function public.get_casier_cliches()
returns table (phrase text, needs_detail boolean)
language sql stable security definer set search_path = '' as $$
  select c.phrase, c.needs_detail from public.casier_cliches c
  where c.is_active and (select auth.uid()) is not null
  order by c.lang, c.id
$$;
revoke execute on function public.get_casier_cliches() from public, anon, authenticated, service_role;
grant execute on function public.get_casier_cliches() to authenticated;
$mig$]);

-- ===== 20261022100000_phase9b_parloir_nudge.sql =====
-- Phase 9b [P1]: la relance à 48 h du Parloir sans horaire (SPEC §13). Permis permanent for 48 h,
-- no Cavale ever proposed in the conversation, last message older than 24 h: a discreet banner
-- « Toujours là ? », once per member and per conversation (marked as seen when shown).

alter table public.conversations
  add column bad_nudged_at timestamptz,
  add column visitor_nudged_at timestamptz;

-- Whether the banner is due for p_member (a participant) in c.
create function private.nudge_due(c public.conversations, p_member uuid)
returns boolean language sql stable set search_path = '' as $$
  select c.status = 'open'
    and c.released_at <= now() - interval '48 hours'
    and coalesce(c.last_message_at, c.released_at) <= now() - interval '24 hours'
    and c.bad_id is not null and c.visitor_id is not null
    and case when p_member = c.bad_id then c.bad_nudged_at else c.visitor_nudged_at end is null
    and not exists (select 1 from public.date_proposals d where d.conversation_id = c.id)
$$;
revoke execute on function private.nudge_due(public.conversations, uuid) from public, anon, authenticated, service_role;

-- Same function as Phase 7d, plus `nudge`.
create or replace function public.get_conversation(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations; o public.profiles;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into o from public.profiles where id = case when me = c.bad_id then c.visitor_id else c.bad_id end;
  return jsonb_build_object(
    'id', c.id, 'request_id', c.request_id, 'status', c.status, 'released_at', c.released_at,
    'i_am_bad', me = c.bad_id,
    'unmasked', private.can_unmask(c.id),
    'other_deleted', o.id is null,
    'nudge', private.nudge_due(c, me),
    'other', jsonb_build_object('id', o.id, 'pseudo', o.pseudo, 'gender', o.gender,
      'photo_small', (select ph.public_path_small from public.photos ph
                      where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved')));
end;
$$;

-- The banner was shown to the caller: it will not come back in this conversation.
create function public.ack_parloir_nudge(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  update public.conversations c set
    bad_nudged_at = case when me = c.bad_id then coalesce(c.bad_nudged_at, now()) else c.bad_nudged_at end,
    visitor_nudged_at = case when me = c.visitor_id then coalesce(c.visitor_nudged_at, now()) else c.visitor_nudged_at end
  where c.id = p_conversation and me in (c.bad_id, c.visitor_id);
end;
$$;
revoke execute on function public.ack_parloir_nudge(uuid) from public, anon, authenticated, service_role;
grant execute on function public.ack_parloir_nudge(uuid) to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022100000', 'phase9b_parloir_nudge', array[$mig$-- Phase 9b [P1]: la relance à 48 h du Parloir sans horaire (SPEC §13). Permis permanent for 48 h,
-- no Cavale ever proposed in the conversation, last message older than 24 h: a discreet banner
-- « Toujours là ? », once per member and per conversation (marked as seen when shown).

alter table public.conversations
  add column bad_nudged_at timestamptz,
  add column visitor_nudged_at timestamptz;

-- Whether the banner is due for p_member (a participant) in c.
create function private.nudge_due(c public.conversations, p_member uuid)
returns boolean language sql stable set search_path = '' as $$
  select c.status = 'open'
    and c.released_at <= now() - interval '48 hours'
    and coalesce(c.last_message_at, c.released_at) <= now() - interval '24 hours'
    and c.bad_id is not null and c.visitor_id is not null
    and case when p_member = c.bad_id then c.bad_nudged_at else c.visitor_nudged_at end is null
    and not exists (select 1 from public.date_proposals d where d.conversation_id = c.id)
$$;
revoke execute on function private.nudge_due(public.conversations, uuid) from public, anon, authenticated, service_role;

-- Same function as Phase 7d, plus `nudge`.
create or replace function public.get_conversation(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations; o public.profiles;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into o from public.profiles where id = case when me = c.bad_id then c.visitor_id else c.bad_id end;
  return jsonb_build_object(
    'id', c.id, 'request_id', c.request_id, 'status', c.status, 'released_at', c.released_at,
    'i_am_bad', me = c.bad_id,
    'unmasked', private.can_unmask(c.id),
    'other_deleted', o.id is null,
    'nudge', private.nudge_due(c, me),
    'other', jsonb_build_object('id', o.id, 'pseudo', o.pseudo, 'gender', o.gender,
      'photo_small', (select ph.public_path_small from public.photos ph
                      where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved')));
end;
$$;

-- The banner was shown to the caller: it will not come back in this conversation.
create function public.ack_parloir_nudge(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  update public.conversations c set
    bad_nudged_at = case when me = c.bad_id then coalesce(c.bad_nudged_at, now()) else c.bad_nudged_at end,
    visitor_nudged_at = case when me = c.visitor_id then coalesce(c.visitor_nudged_at, now()) else c.visitor_nudged_at end
  where c.id = p_conversation and me in (c.bad_id, c.visitor_id);
end;
$$;
revoke execute on function public.ack_parloir_nudge(uuid) from public, anon, authenticated, service_role;
grant execute on function public.ack_parloir_nudge(uuid) to authenticated;
$mig$]);

-- ===== 20261022110000_phase9c_recruited_badge.sql =====
-- Phase 9c [P1]: le badge « Complices recrutés » (SPEC §5, §3). The number of members a Bad brought
-- in with their referral link, shown on their Fiche. One count for the Fiche and for « Mon
-- quartier »: onboarding finished, neither banned nor a seed profile.

create function private.recruited_count(p_member uuid)
returns integer language sql stable set search_path = '' as $$
  select count(*)::integer from public.profiles p
  where p.referred_by = p_member and p.onboarding_completed_at is not null
    and p.banned_at is null and not p.is_seed
$$;
revoke execute on function private.recruited_count(uuid) from public, anon, authenticated, service_role;

create or replace function public.referral_count()
returns integer language sql stable security definer set search_path = '' as $$
  select private.recruited_count((select auth.uid()))
$$;

-- Same function as Phase 4, plus `recruited`.
create or replace function public.get_fiche(p_bad uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v public.profiles;
  b public.profiles;
  c public.casier_charges;
  open_request public.visit_requests;
  score smallint;
begin
  select * into b from public.profiles where id = p_bad and role = 'bad';
  if not found or me is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if me <> p_bad then
    if public.is_blocked_between(me, p_bad)
       or not (public.can_view_bad(me, p_bad) or public.has_open_relation(me, p_bad)) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    select * into v from public.profiles where id = me;
  end if;
  select * into c from public.casier_charges where profile_id = p_bad;
  select * into open_request from public.visit_requests r
    where r.visitor_id = me and r.bad_id = p_bad and r.status in ('pending', 'accepted', 'released')
    order by r.created_at desc limit 1;
  if me <> p_bad then
    select x.score into score from public.complicity_score(me, p_bad) x;
  end if;
  return jsonb_build_object(
    'id', b.id,
    'ecrou', b.ecrou,
    'pseudo', b.pseudo,
    'gender', b.gender,
    'age', public.age_years(b.birthdate),
    'city', public.place_name(b.place_id),
    'distance_km', case when me <> p_bad then public.distance_km(v, b) end,
    'seeking_genders', to_jsonb(b.seeking_genders),
    'seek_age_min', b.seek_age_min,
    'seek_age_max', b.seek_age_max,
    'on_file_since', to_char(b.created_at, 'YYYY-MM'),
    'photos', public.public_photos(b.id, array[0, 1, 2, 3, 4, 5]::smallint[]),
    'tribes', public.public_tribes(b.id),
    'charges', case when c.profile_id is null then '[]'::jsonb
                    else jsonb_build_array(c.charge_1, c.charge_2, c.charge_3) end,
    'casier_changed_since_request', open_request.id is not null and b.casier_updated_at > open_request.created_at,
    'bio', b.bio,
    'good_conduct', b.is_reglo,
    'recruited', private.recruited_count(b.id),
    'requests_open', b.requests_open and not b.is_paused,
    'complicity', score,
    'common_points', case when me <> p_bad then
        (select coalesce(jsonb_agg(jsonb_build_object('question', cp.question, 'answer', cp.answer)), '[]')
         from public.common_points(me, p_bad, 3) cp) else '[]'::jsonb end,
    'my_request_status', open_request.status,
    'cooldown_until', case when me <> p_bad then public.pair_cooldown_until(me, p_bad) end
  );
end;
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022110000', 'phase9c_recruited_badge', array[$mig$-- Phase 9c [P1]: le badge « Complices recrutés » (SPEC §5, §3). The number of members a Bad brought
-- in with their referral link, shown on their Fiche. One count for the Fiche and for « Mon
-- quartier »: onboarding finished, neither banned nor a seed profile.

create function private.recruited_count(p_member uuid)
returns integer language sql stable set search_path = '' as $$
  select count(*)::integer from public.profiles p
  where p.referred_by = p_member and p.onboarding_completed_at is not null
    and p.banned_at is null and not p.is_seed
$$;
revoke execute on function private.recruited_count(uuid) from public, anon, authenticated, service_role;

create or replace function public.referral_count()
returns integer language sql stable security definer set search_path = '' as $$
  select private.recruited_count((select auth.uid()))
$$;

-- Same function as Phase 4, plus `recruited`.
create or replace function public.get_fiche(p_bad uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v public.profiles;
  b public.profiles;
  c public.casier_charges;
  open_request public.visit_requests;
  score smallint;
begin
  select * into b from public.profiles where id = p_bad and role = 'bad';
  if not found or me is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if me <> p_bad then
    if public.is_blocked_between(me, p_bad)
       or not (public.can_view_bad(me, p_bad) or public.has_open_relation(me, p_bad)) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    select * into v from public.profiles where id = me;
  end if;
  select * into c from public.casier_charges where profile_id = p_bad;
  select * into open_request from public.visit_requests r
    where r.visitor_id = me and r.bad_id = p_bad and r.status in ('pending', 'accepted', 'released')
    order by r.created_at desc limit 1;
  if me <> p_bad then
    select x.score into score from public.complicity_score(me, p_bad) x;
  end if;
  return jsonb_build_object(
    'id', b.id,
    'ecrou', b.ecrou,
    'pseudo', b.pseudo,
    'gender', b.gender,
    'age', public.age_years(b.birthdate),
    'city', public.place_name(b.place_id),
    'distance_km', case when me <> p_bad then public.distance_km(v, b) end,
    'seeking_genders', to_jsonb(b.seeking_genders),
    'seek_age_min', b.seek_age_min,
    'seek_age_max', b.seek_age_max,
    'on_file_since', to_char(b.created_at, 'YYYY-MM'),
    'photos', public.public_photos(b.id, array[0, 1, 2, 3, 4, 5]::smallint[]),
    'tribes', public.public_tribes(b.id),
    'charges', case when c.profile_id is null then '[]'::jsonb
                    else jsonb_build_array(c.charge_1, c.charge_2, c.charge_3) end,
    'casier_changed_since_request', open_request.id is not null and b.casier_updated_at > open_request.created_at,
    'bio', b.bio,
    'good_conduct', b.is_reglo,
    'recruited', private.recruited_count(b.id),
    'requests_open', b.requests_open and not b.is_paused,
    'complicity', score,
    'common_points', case when me <> p_bad then
        (select coalesce(jsonb_agg(jsonb_build_object('question', cp.question, 'answer', cp.answer)), '[]')
         from public.common_points(me, p_bad, 3) cp) else '[]'::jsonb end,
    'my_request_status', open_request.status,
    'cooldown_until', case when me <> p_bad then public.pair_cooldown_until(me, p_bad) end
  );
end;
$$;
$mig$]);

-- ===== 20261023090000_photo_cutout.sql =====
-- Photos on the height chart (owner's decision 2026-10-23, version B). The member's browser cuts
-- the person out before sending (MediaPipe, on the device); the server keeps the transparency only
-- when the file really has some, and says so here. Displays use it to put the cut-out photo in
-- front of the fixed wall, or the graduations over a photo kept as it is (version A). Set by the
-- server with the secret key: members still write only the columns they wrote before.

alter table public.photos add column is_cutout boolean not null default false;

-- Same function as Phase 4, plus `cutout` (the Fiche, and the Permis through it).
create or replace function public.public_photos(p_owner uuid, p_positions smallint[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('position', ph.position, 'large', ph.public_path_large,
                                               'small', ph.public_path_small, 'cutout', ph.is_cutout)
                            order by ph.position), '[]')
  from public.photos ph
  where ph.owner_id = p_owner and ph.status = 'approved' and ph.position = any (p_positions)
$$;

-- The Greffe shows each pending photo as it will be displayed: whether it is cut out.
create function public.admin_photo_cutouts(p_ids uuid[])
returns table (photo_id uuid, is_cutout boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query select ph.id, ph.is_cutout from public.photos ph where ph.id = any (p_ids);
end;
$$;
revoke execute on function public.admin_photo_cutouts(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_photo_cutouts(uuid[]) to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261023090000', 'photo_cutout', array[$mig$-- Photos on the height chart (owner's decision 2026-10-23, version B). The member's browser cuts
-- the person out before sending (MediaPipe, on the device); the server keeps the transparency only
-- when the file really has some, and says so here. Displays use it to put the cut-out photo in
-- front of the fixed wall, or the graduations over a photo kept as it is (version A). Set by the
-- server with the secret key: members still write only the columns they wrote before.

alter table public.photos add column is_cutout boolean not null default false;

-- Same function as Phase 4, plus `cutout` (the Fiche, and the Permis through it).
create or replace function public.public_photos(p_owner uuid, p_positions smallint[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('position', ph.position, 'large', ph.public_path_large,
                                               'small', ph.public_path_small, 'cutout', ph.is_cutout)
                            order by ph.position), '[]')
  from public.photos ph
  where ph.owner_id = p_owner and ph.status = 'approved' and ph.position = any (p_positions)
$$;

-- The Greffe shows each pending photo as it will be displayed: whether it is cut out.
create function public.admin_photo_cutouts(p_ids uuid[])
returns table (photo_id uuid, is_cutout boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query select ph.id, ph.is_cutout from public.photos ph where ph.id = any (p_ids);
end;
$$;
revoke execute on function public.admin_photo_cutouts(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_photo_cutouts(uuid[]) to authenticated;
$mig$]);

-- ===== 20261023120000_photo_cutout_required.sql =====
-- Photos on the height chart, final decision of the owner (2026-10-23): the same wall for everyone,
-- no choice. The 3 poses of a Bad and the photo of a Visitor (positions 0 to 2) are always cut
-- out. The member's browser does it at the upload; when it cannot, the original is sent and waits
-- for the Greffe, which cuts it out in the admin's browser (same tool) before it can be validated.

alter table public.photos add column needs_cutout boolean not null default false;

-- Pending poses sent before this decision and not cut out: the Greffe cuts them out first.
update public.photos set needs_cutout = true
where status = 'pending' and position <= 2 and not is_cutout;

-- A photo waiting for its cut-out is never validated as it is.
alter table public.photos add constraint photos_cutout_before_approval
  check (not (status = 'approved' and needs_cutout));

-- A pose sent by a member waits for its cut-out until the server has found the transparency in
-- the file (the server then clears it with the secret key). Rows written by the server, the seed
-- or the tests (other roles) keep the defaults.
create function public.photos_cutout_default()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    new.is_cutout := false;
    new.needs_cutout := new.position <= 2;
  end if;
  return new;
end;
$$;
revoke execute on function public.photos_cutout_default() from public, anon, authenticated;
create trigger photos_cutout_default
  before insert on public.photos
  for each row execute function public.photos_cutout_default();

-- The Greffe: which pending photos still wait for their cut-out.
create function public.admin_photos_to_cut_out(p_ids uuid[])
returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query select ph.id from public.photos ph
    where ph.id = any (p_ids) and ph.status = 'pending' and ph.needs_cutout;
end;
$$;
revoke execute on function public.admin_photos_to_cut_out(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_photos_to_cut_out(uuid[]) to authenticated;

-- The Greffe records its cut-out of a pending photo: the server has checked the transparency of
-- the new file and stored it in the owner's folder. Returns the previous file, to be removed.
create function public.admin_store_cutout(p_photo uuid, p_pending_path text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  previous text;
  owner uuid;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select ph.pending_path, ph.owner_id into previous, owner from public.photos ph
    where ph.id = p_photo and ph.status = 'pending' and ph.needs_cutout
    for update;
  if not found then raise exception 'photo_not_waiting_cutout' using errcode = 'P0001'; end if;
  if p_pending_path is null or p_pending_path not like owner::text || '/%' then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  update public.photos set pending_path = p_pending_path, is_cutout = true, needs_cutout = false
    where id = p_photo;
  return previous;
end;
$$;
revoke execute on function public.admin_store_cutout(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_store_cutout(uuid, text) to authenticated;

------------------------------------------------------------------------------------------------
-- Preview only: cutting out, in a batch, the photos validated before this decision
------------------------------------------------------------------------------------------------
-- Off everywhere. Switched on by hand on the preview base only; never on the production base.
alter table public.app_settings add column photo_batch_allowed boolean not null default false;

create function public.admin_photo_batch(p_limit integer)
returns table (photo_id uuid, photo_position smallint, pseudo text, role public.member_role,
               public_path_large text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if not (select s.photo_batch_allowed from public.app_settings s) then
    raise exception 'batch_not_allowed' using errcode = '42501';
  end if;
  return query
    select ph.id, ph.position, p.pseudo::text, p.role, ph.public_path_large
    from public.photos ph join public.profiles p on p.id = ph.owner_id
    where ph.status = 'approved' and ph.position <= 2 and not ph.is_cutout
      and ph.public_path_large is not null
    order by ph.reviewed_at nulls first, ph.id
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;
revoke execute on function public.admin_photo_batch(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_photo_batch(integer) to authenticated;

-- Replaces a validated photo by its cut-out (new random names, written by the server). Returns
-- the previous files, to be removed.
create function public.admin_replace_public_photo(p_photo uuid, p_large text, p_small text)
returns table (old_large text, old_small text)
language plpgsql security definer set search_path = '' as $$
declare
  previous_large text;
  previous_small text;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if not (select s.photo_batch_allowed from public.app_settings s) then
    raise exception 'batch_not_allowed' using errcode = '42501';
  end if;
  if p_large is null or p_small is null or p_large like '%/%' or p_small like '%/%' then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  select ph.public_path_large, ph.public_path_small into previous_large, previous_small
    from public.photos ph
    where ph.id = p_photo and ph.status = 'approved' and ph.position <= 2 and not ph.is_cutout
    for update;
  if not found then raise exception 'photo_not_in_batch' using errcode = 'P0001'; end if;
  update public.photos set public_path_large = p_large, public_path_small = p_small, is_cutout = true
    where id = p_photo;
  return query select previous_large, previous_small;
end;
$$;
revoke execute on function public.admin_replace_public_photo(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_replace_public_photo(uuid, text, text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261023120000', 'photo_cutout_required', array[$mig$-- Photos on the height chart, final decision of the owner (2026-10-23): the same wall for everyone,
-- no choice. The 3 poses of a Bad and the photo of a Visitor (positions 0 to 2) are always cut
-- out. The member's browser does it at the upload; when it cannot, the original is sent and waits
-- for the Greffe, which cuts it out in the admin's browser (same tool) before it can be validated.

alter table public.photos add column needs_cutout boolean not null default false;

-- Pending poses sent before this decision and not cut out: the Greffe cuts them out first.
update public.photos set needs_cutout = true
where status = 'pending' and position <= 2 and not is_cutout;

-- A photo waiting for its cut-out is never validated as it is.
alter table public.photos add constraint photos_cutout_before_approval
  check (not (status = 'approved' and needs_cutout));

-- A pose sent by a member waits for its cut-out until the server has found the transparency in
-- the file (the server then clears it with the secret key). Rows written by the server, the seed
-- or the tests (other roles) keep the defaults.
create function public.photos_cutout_default()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    new.is_cutout := false;
    new.needs_cutout := new.position <= 2;
  end if;
  return new;
end;
$$;
revoke execute on function public.photos_cutout_default() from public, anon, authenticated;
create trigger photos_cutout_default
  before insert on public.photos
  for each row execute function public.photos_cutout_default();

-- The Greffe: which pending photos still wait for their cut-out.
create function public.admin_photos_to_cut_out(p_ids uuid[])
returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query select ph.id from public.photos ph
    where ph.id = any (p_ids) and ph.status = 'pending' and ph.needs_cutout;
end;
$$;
revoke execute on function public.admin_photos_to_cut_out(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_photos_to_cut_out(uuid[]) to authenticated;

-- The Greffe records its cut-out of a pending photo: the server has checked the transparency of
-- the new file and stored it in the owner's folder. Returns the previous file, to be removed.
create function public.admin_store_cutout(p_photo uuid, p_pending_path text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  previous text;
  owner uuid;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select ph.pending_path, ph.owner_id into previous, owner from public.photos ph
    where ph.id = p_photo and ph.status = 'pending' and ph.needs_cutout
    for update;
  if not found then raise exception 'photo_not_waiting_cutout' using errcode = 'P0001'; end if;
  if p_pending_path is null or p_pending_path not like owner::text || '/%' then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  update public.photos set pending_path = p_pending_path, is_cutout = true, needs_cutout = false
    where id = p_photo;
  return previous;
end;
$$;
revoke execute on function public.admin_store_cutout(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_store_cutout(uuid, text) to authenticated;

------------------------------------------------------------------------------------------------
-- Preview only: cutting out, in a batch, the photos validated before this decision
------------------------------------------------------------------------------------------------
-- Off everywhere. Switched on by hand on the preview base only; never on the production base.
alter table public.app_settings add column photo_batch_allowed boolean not null default false;

create function public.admin_photo_batch(p_limit integer)
returns table (photo_id uuid, photo_position smallint, pseudo text, role public.member_role,
               public_path_large text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if not (select s.photo_batch_allowed from public.app_settings s) then
    raise exception 'batch_not_allowed' using errcode = '42501';
  end if;
  return query
    select ph.id, ph.position, p.pseudo::text, p.role, ph.public_path_large
    from public.photos ph join public.profiles p on p.id = ph.owner_id
    where ph.status = 'approved' and ph.position <= 2 and not ph.is_cutout
      and ph.public_path_large is not null
    order by ph.reviewed_at nulls first, ph.id
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;
revoke execute on function public.admin_photo_batch(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_photo_batch(integer) to authenticated;

-- Replaces a validated photo by its cut-out (new random names, written by the server). Returns
-- the previous files, to be removed.
create function public.admin_replace_public_photo(p_photo uuid, p_large text, p_small text)
returns table (old_large text, old_small text)
language plpgsql security definer set search_path = '' as $$
declare
  previous_large text;
  previous_small text;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if not (select s.photo_batch_allowed from public.app_settings s) then
    raise exception 'batch_not_allowed' using errcode = '42501';
  end if;
  if p_large is null or p_small is null or p_large like '%/%' or p_small like '%/%' then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  select ph.public_path_large, ph.public_path_small into previous_large, previous_small
    from public.photos ph
    where ph.id = p_photo and ph.status = 'approved' and ph.position <= 2 and not ph.is_cutout
    for update;
  if not found then raise exception 'photo_not_in_batch' using errcode = 'P0001'; end if;
  update public.photos set public_path_large = p_large, public_path_small = p_small, is_cutout = true
    where id = p_photo;
  return query select previous_large, previous_small;
end;
$$;
revoke execute on function public.admin_replace_public_photo(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_replace_public_photo(uuid, text, text) to authenticated;
$mig$]);

commit;

-- Empreintes (sans les blancs) : colonne attendu = colonne base.
select m.version, m.name, x.expected as attendu, md5(regexp_replace(array_to_string(m.statements, ';'), '\s', '', 'g')) as base
from supabase_migrations.schema_migrations m
join (values
  ('20261022090000', 'deb524ced3478b4667b8eaa48534af5b'),
  ('20261022100000', '11e2afc9d09a3955af7246f7af54ebfe'),
  ('20261022110000', 'f73a5a5f5783260eebf50446f86ff447'),
  ('20261023090000', 'fe84c450c87d0e41af1c16b03ca10ba4'),
  ('20261023120000', '972a866396d4f9bf69a66b5c2c21560c')
) as x (version, expected) on x.version = m.version
order by m.version;
