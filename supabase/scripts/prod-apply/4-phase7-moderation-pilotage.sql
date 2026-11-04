-- UTILISÉ LE 2026-11-04, DEVENU INUTILE : phases 6 à 9 déjà en production. Ne pas relancer (voir README.md).
-- bad-boys-prod (hmmobtyherwuhrhymfbk). Script 4 sur 9, à lancer dans l'ordre, dans le SQL Editor.
-- Généré par scripts/build-prod-apply.mjs (ne pas modifier à la main). Une seule transaction :
-- en cas d'erreur, rien n'est appliqué ; relancer le même script après correction.
-- Migrations (texte exact des fichiers, puis leur ligne d'historique) :
--   20261019130100_phase7a_moderation.sql
--   20261020090000_phase7b_pilotage.sql
-- Contient un mot destructif (delete, drop ou truncate), dans : phase7a_moderation, phase7b_pilotage. L'éditeur demandera une confirmation.

begin;

-- Garde : la base est à l'étape précédente, et ce script n'a pas déjà été lancé.
do $guard$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261019130000') then
    raise exception 'étape précédente absente (20261019130000) : lancer les scripts dans l''ordre';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version >= '20261019130100') then
    raise exception 'déjà appliqué (20261019130100 ou plus récent présent)';
  end if;
end
$guard$;

-- ===== 20261019130100_phase7a_moderation.sql =====
-- Phase 7a: la modération (SPEC §10 DSA, §14, §15). Reports and flagged texts are decided by an
-- admin with a written motive; the reporter and the member concerned each receive their own
-- exposé des motifs (never the identity of the reporter, never the sanction of someone else).
-- Sanctions: warning, suspension (1 to 90 days), ban (e-mail fingerprint + Auth account banned,
-- sessions revoked), Fiche hidden, Bonne conduite withdrawn, text removed. Every admin function
-- checks is_admin() (second factor, aal2) first; moderation_actions stays append-only; the super
-- admin has no profile, so nothing here can reach them (Phase 5a-ter guards still apply).

------------------------------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------------------------------
-- The motive written for the reporter (the member concerned gets the one of moderation_actions).
alter table public.reports add column decision_reason varchar(1000);
alter table public.moderation_actions
  add column ends_at timestamptz,
  add column flag_id bigint references public.flagged_texts (id) on delete set null;
alter table public.flagged_texts
  add column decided_by uuid,
  add column decided_at timestamptz,
  add column decision_reason varchar(1000);
create index moderation_actions_recent on public.moderation_actions (created_at desc);
-- A message removed by the Greffe: its text is erased, the bubble says so.
alter table public.messages add column removed_at timestamptz;

------------------------------------------------------------------------------------------------
-- 2. Internal helpers (schema private, never exposed; invoker rights, called by the functions
--    below only)
------------------------------------------------------------------------------------------------
-- A motive is mandatory for every decision that reaches a member: 10 to 1,000 characters.
create function private.motive(p_text text)
returns text language plpgsql immutable set search_path = '' as $$
declare t text := btrim(coalesce(p_text, ''));
begin
  if char_length(t) < 10 or char_length(t) > 1000 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  return t;
end;
$$;

create function private.member_state(p public.profiles)
returns text language sql stable set search_path = '' as $$
  select case
    when p.banned_at is not null then 'banned'
    when p.suspended_until > now() then 'suspended'
    when p.hidden_reason is not null then 'hidden'
    when p.onboarding_completed_at is null then 'onboarding'
    else 'active' end
$$;

-- Closes every open case of a sanctioned member, so that nobody meets or writes to them meanwhile
-- (the close trigger cancels the visits, the Cavales and the conversations). The other one is told
-- neutrally: « Affaire classée » for a Visitor, the cancelled visit for a Bad.
create function private.close_cases_of(p_user uuid, p_reason public.case_close_reason)
returns void language plpgsql set search_path = '' as $$
begin
  perform public.notify(v.bad_id, 'visit_cancelled', jsonb_build_object('request_id', v.request_id, 'visit_id', v.id))
  from public.visits v where v.visitor_id = p_user and v.status = 'scheduled';
  with closed as (
    update public.visit_requests r
    set status = 'closed', close_reason = p_reason, closed_at = now(), choose_deadline = null, repropose_deadline = null
    where r.status in ('pending', 'accepted', 'released') and p_user in (r.visitor_id, r.bad_id)
    returning r.id, r.visitor_id, r.bad_id
  )
  insert into public.notifications (user_id, type, payload)
  select c.visitor_id, 'request_dismissed', jsonb_build_object('request_id', c.id)
  from closed c where c.bad_id = p_user;
end;
$$;

-- Who may be sanctioned: a member with a profile (so never the super admin), never oneself, and an
-- admin only by the super admin.
create function private.sanction_target(p_user uuid)
returns public.profiles language plpgsql set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = p_user for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_user = (select auth.uid()) then raise exception 'self_sanction' using errcode = '42501'; end if;
  if exists (select 1 from public.admin_users where user_id = p_user)
     and not exists (select 1 from public.super_admins where user_id = (select auth.uid())) then
    raise exception 'admin_protected' using errcode = '42501';
  end if;
  return p;
end;
$$;

-- Applies one sanction, records it (append-only) and tells the member concerned. A banned member
-- cannot sign in any more: the exposé des motifs also goes by e-mail (sent in Phase 7e).
create function private.apply_sanction(p_user uuid, p_action public.moderation_action_type, p_reason text,
  p_days integer, p_report bigint, p_flag bigint)
returns bigint language plpgsql set search_path = '' as $$
declare
  p public.profiles := private.sanction_target(p_user);
  ends timestamptz;
  address text;
  action_id bigint;
begin
  case p_action
    when 'warn', 'text_remove' then
      null;
    when 'suspend' then
      if p_days is null or p_days not between 1 and 90 then raise exception 'invalid_days' using errcode = '22023'; end if;
      ends := now() + make_interval(days => p_days);
      update public.profiles set suspended_until = greatest(coalesce(suspended_until, ends), ends) where id = p_user;
      perform private.close_cases_of(p_user, 'moderation');
    when 'ban' then
      if p.banned_at is not null then raise exception 'already_banned' using errcode = '23514'; end if;
      update public.profiles set banned_at = now() where id = p_user;
      select u.email into address from auth.users u where u.id = p_user;
      if address is not null then
        insert into public.banned_email_hashes (hash, expires_at)
        values (public.ban_email_hash(address),
                now() + make_interval(months => (select s.ban_hash_retention_months from public.app_settings s where s.id)))
        on conflict (hash) do update set banned_at = now(), expires_at = excluded.expires_at;
      end if;
      update auth.users set banned_until = now() + interval '100 years' where id = p_user;
      delete from auth.sessions where user_id = p_user;
      perform private.close_cases_of(p_user, 'banned');
    when 'unban' then
      -- Lifting a ban is reserved to the super admin.
      if not exists (select 1 from public.super_admins where user_id = (select auth.uid())) then
        raise exception 'super_admin_only' using errcode = '42501';
      end if;
      if p.banned_at is null then raise exception 'not_banned' using errcode = '23514'; end if;
      update public.profiles set banned_at = null where id = p_user;
      update auth.users set banned_until = null where id = p_user;
      select u.email into address from auth.users u where u.id = p_user;
      if address is not null then
        delete from public.banned_email_hashes where hash = public.ban_email_hash(address);
      end if;
    when 'hide_profile' then
      if p.hidden_reason = 'moderation' then raise exception 'already_hidden' using errcode = '23514'; end if;
      update public.profiles set hidden_reason = 'moderation' where id = p_user;
      perform private.close_cases_of(p_user, 'moderation');
    when 'unhide_profile' then
      if p.hidden_reason is null then raise exception 'not_hidden' using errcode = '23514'; end if;
      update public.profiles set hidden_reason = null where id = p_user;
    when 'revoke_good_conduct' then
      if not p.is_reglo then raise exception 'no_good_conduct' using errcode = '23514'; end if;
    else
      raise exception 'invalid_action' using errcode = '22023';
  end case;
  -- Bonne conduite goes at once with a report upheld, a suspension, a ban or a hidden Fiche (SPEC §14).
  if p_action in ('suspend', 'ban', 'hide_profile', 'revoke_good_conduct') or p_report is not null then
    update public.profiles set is_reglo = false where id = p_user and is_reglo;
  end if;
  insert into public.moderation_actions (target_user_id, action, reason, report_id, flag_id, admin_id, ends_at)
  values (p_user, p_action, p_reason, p_report, p_flag, (select auth.uid()), ends)
  returning id into action_id;
  perform public.notify(p_user, 'sanction', jsonb_build_object('action_id', action_id));
  if p_action = 'ban' then
    insert into public.email_outbox (user_id, kind, payload, priority)
    values (p_user, 'moderation_decision', jsonb_build_object('action_id', action_id), 10);
  end if;
  return action_id;
end;
$$;

revoke execute on function private.motive(text), private.member_state(public.profiles),
  private.close_cases_of(uuid, public.case_close_reason), private.sanction_target(uuid),
  private.apply_sanction(uuid, public.moderation_action_type, text, integer, bigint, bigint)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 3. Admin: the report queue and its decision
------------------------------------------------------------------------------------------------
-- Open reports, « mineur » first, then threats, harassment, scams, then the oldest. The reported
-- content itself is shown (the text, the photo), nothing more of the conversation.
create function public.admin_report_queue(p_limit integer default 50)
returns table (report_id bigint, created_at timestamptz, category public.report_category, comment text,
  target_type public.report_target, target_id text, target_user_id uuid, target_pseudo text,
  target_role public.member_role, target_state text, target_open_reports integer,
  target_upheld_reports integer, reporter_pseudo text, content text, photo_path text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select r.id, r.created_at, r.category, r.comment::text, r.target_type, r.target_id, r.target_user_id,
      t.pseudo::text, t.role, private.member_state(t),
      (select count(*)::integer from public.reports x where x.target_user_id = r.target_user_id and x.status = 'open'),
      (select count(*)::integer from public.reports x where x.target_user_id = r.target_user_id and x.status = 'upheld'),
      rp.pseudo::text,
      case r.target_type
        when 'profile' then t.bio::text
        when 'permit' then t.visit_motive::text
        when 'casier' then (select concat_ws(' / ', c.charge_1, c.charge_2, c.charge_3)
                            from public.casier_charges c where c.profile_id = t.id)
        when 'visit_request' then (select v.note::text from public.visit_requests v where v.id::text = r.target_id)
        when 'message' then (select m.body::text from public.messages m
                             where m.id::text = r.target_id and m.removed_at is null)
      end,
      case when r.target_type = 'photo' then
        (select ph.public_path_large from public.photos ph where ph.id::text = r.target_id) end
    from public.reports r
    left join public.profiles t on t.id = r.target_user_id
    left join public.profiles rp on rp.id = r.reporter_id
    where r.status = 'open'
    order by case r.category when 'minor' then 0 when 'violence_threat' then 1 when 'harassment' then 2
                             when 'scam' then 3 else 4 end,
             r.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- One decision per report: upheld (with a sanction and a motive for the member concerned) or
-- rejected; the reporter always gets a motive. A « mineur » hiding is lifted once no « mineur »
-- report on the member is still open and none was upheld.
create function public.admin_decide_report(p_report bigint, p_upheld boolean, p_reason_reporter text,
  p_action public.moderation_action_type default null, p_reason_target text default null,
  p_days integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reports; reporter_motive text;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found or r.target_user_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'open' then raise exception 'already_decided' using errcode = '23514'; end if;
  reporter_motive := private.motive(p_reason_reporter);
  if p_upheld then
    if p_action is null or p_action not in ('warn', 'suspend', 'ban', 'hide_profile') then
      raise exception 'invalid_action' using errcode = '22023';
    end if;
    perform private.apply_sanction(r.target_user_id, p_action, private.motive(p_reason_target), p_days, r.id, null);
  elsif p_action is not null then
    raise exception 'invalid_action' using errcode = '22023';
  elsif r.target_user_id = (select auth.uid()) then
    raise exception 'self_sanction' using errcode = '42501';
  end if;
  update public.reports
  set status = case when p_upheld then 'upheld'::public.report_status else 'rejected'::public.report_status end,
      decided_by = (select auth.uid()), decided_at = now(), decision_reason = reporter_motive
  where id = r.id;
  if not p_upheld and r.category = 'minor'
     and not exists (select 1 from public.reports x where x.target_user_id = r.target_user_id
                     and x.category = 'minor' and x.status in ('open', 'upheld')) then
    update public.profiles set hidden_reason = null where id = r.target_user_id and hidden_reason = 'minor_report';
  end if;
  if r.reporter_id is not null then
    perform public.notify(r.reporter_id, 'report_decided', jsonb_build_object('report_id', r.id));
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Admin: flagged texts (keywords)
------------------------------------------------------------------------------------------------
-- Texts the Greffe can erase itself; the others (pseudo, Motif de visite, Casier, place of a
-- Cavale) are upheld and dealt with by a sanction (the Fiche hidden until it is corrected).
create function private.removable_source(p_source public.flag_source)
returns boolean language sql immutable set search_path = '' as $$
  select p_source in ('bio', 'tribe_detail', 'visit_request', 'message')
$$;
revoke execute on function private.removable_source(public.flag_source) from public, anon, authenticated, service_role;

create function public.admin_flag_queue(p_limit integer default 50)
returns table (flag_id bigint, created_at timestamptz, source public.flag_source, excerpt text,
  matched_terms text[], user_id uuid, pseudo text, role public.member_role, state text, removable boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select f.id, f.created_at, f.source, f.excerpt, f.matched_terms, f.user_id, p.pseudo::text, p.role,
      private.member_state(p), private.removable_source(f.source)
    from public.flagged_texts f
    left join public.profiles p on p.id = f.user_id
    where f.status = 'open'
    order by f.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- 'clear': nothing wrong (the motive is optional, the member is not told);
-- 'uphold': the text breaks the rules, the admin sanctions from the member page;
-- 'remove': the text is erased and the member gets the motive.
create function public.admin_decide_flag(p_flag bigint, p_decision text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.flagged_texts; motive text;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into f from public.flagged_texts where id = p_flag for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if f.status <> 'open' then raise exception 'already_decided' using errcode = '23514'; end if;
  if p_decision = 'clear' then
    motive := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
    if f.user_id is not null then
      perform private.sanction_target(f.user_id);
      insert into public.moderation_actions (target_user_id, action, reason, flag_id, admin_id)
      values (f.user_id, 'text_clear', motive, f.id, (select auth.uid()));
    end if;
  elsif p_decision = 'uphold' then
    motive := private.motive(p_reason);
  elsif p_decision = 'remove' then
    motive := private.motive(p_reason);
    if not private.removable_source(f.source) then raise exception 'not_removable' using errcode = '23514'; end if;
    case f.source
      when 'bio' then
        update public.profiles set bio = null where id = f.user_id;
      when 'tribe_detail' then
        update public.profile_tribes set detail = null where profile_id = f.user_id and tribe_id::text = f.source_id;
      when 'visit_request' then
        update public.visit_requests set note = null where id::text = f.source_id;
        delete from public.messages m
        where m.kind = 'system' and m.system_payload ->> 'type' = 'note'
          and m.conversation_id in (select c.id from public.conversations c where c.request_id::text = f.source_id);
      when 'message' then
        update public.messages set body = '', removed_at = now() where id::text = f.source_id and kind = 'text';
    end case;
    if f.user_id is not null then
      perform private.apply_sanction(f.user_id, 'text_remove', motive, null, null, f.id);
    end if;
  else
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  update public.flagged_texts
  set status = case when p_decision = 'clear' then 'rejected'::public.report_status else 'upheld'::public.report_status end,
      decided_by = (select auth.uid()), decided_at = now(), decision_reason = motive
  where id = f.id;
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. Admin: members, sanctions, history
------------------------------------------------------------------------------------------------
-- By the start of the pseudo or the exact e-mail (never returned). Never by the N° d'écrou: no
-- function takes it as an input (PARCOURS-DESIGN §2).
create function public.admin_find_members(p_query text)
returns table (user_id uuid, pseudo text, role public.member_role, state text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(coalesce(p_query, ''));
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if char_length(q) < 2 or char_length(q) > 254 then return; end if;
  return query
    select p.id, p.pseudo::text, p.role, private.member_state(p), p.created_at
    from public.profiles p
    where p.pseudo::text ilike replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
       or p.id = (select u.id from auth.users u where lower(u.email) = lower(q) limit 1)
    order by p.pseudo
    limit 20;
end;
$$;

create function public.admin_member(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'id', p.id, 'pseudo', p.pseudo, 'role', p.role, 'gender', p.gender,
    'created_at', p.created_at, 'last_seen_at', p.last_seen_at, 'state', private.member_state(p),
    'suspended_until', case when p.suspended_until > now() then p.suspended_until end,
    'hidden_reason', p.hidden_reason, 'banned_at', p.banned_at, 'good_conduct', p.is_reglo,
    'is_admin', exists (select 1 from public.admin_users a where a.user_id = p.id),
    'zone', (select z.name from public.launch_zones z where z.id = p.zone_id),
    'reports_made', (select count(*) from public.reports r where r.reporter_id = p.id),
    'reports_received', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'category', r.category,
        'target_type', r.target_type, 'status', r.status, 'comment', r.comment, 'decision_reason', r.decision_reason)
        order by r.created_at desc)
      from public.reports r where r.target_user_id = p.id), '[]'),
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'created_at', m.created_at, 'action', m.action,
        'reason', m.reason, 'ends_at', m.ends_at, 'report_id', m.report_id) order by m.created_at desc)
      from public.moderation_actions m where m.target_user_id = p.id), '[]'),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'created_at', f.created_at, 'source', f.source,
        'excerpt', f.excerpt, 'status', f.status) order by f.created_at desc)
      from (select * from public.flagged_texts x where x.user_id = p.id order by x.created_at desc limit 20) f), '[]'));
end;
$$;

create function public.admin_sanction(p_user uuid, p_action public.moderation_action_type, p_reason text,
  p_days integer default null)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_action not in ('warn', 'suspend', 'ban', 'unban', 'hide_profile', 'unhide_profile', 'revoke_good_conduct') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  return private.apply_sanction(p_user, p_action, private.motive(p_reason), p_days, null, null);
end;
$$;

-- Historique des décisions: every action recorded, the newest first.
create function public.admin_moderation_log(p_limit integer default 100)
returns table (action_id bigint, created_at timestamptz, action public.moderation_action_type, reason text,
  ends_at timestamptz, target_user_id uuid, target_pseudo text, report_id bigint, flag_id bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select m.id, m.created_at, m.action, m.reason, m.ends_at, m.target_user_id, p.pseudo::text, m.report_id, m.flag_id
    from public.moderation_actions m
    left join public.profiles p on p.id = m.target_user_id
    where m.action not in ('photo_approve', 'photo_reject')
    order by m.created_at desc, m.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

------------------------------------------------------------------------------------------------
-- 6. Members: the exposé des motifs
------------------------------------------------------------------------------------------------
-- The sanction in force, if any (the screen shown instead of the site).
create function public.get_my_sanction()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when p.banned_at is not null then jsonb_build_object('state', 'banned', 'reason',
      (select m.reason from public.moderation_actions m where m.target_user_id = p.id and m.action = 'ban'
       order by m.created_at desc limit 1))
    when p.suspended_until > now() then jsonb_build_object('state', 'suspended', 'until', p.suspended_until, 'reason',
      (select m.reason from public.moderation_actions m where m.target_user_id = p.id and m.action = 'suspend'
       order by m.created_at desc limit 1))
    when p.hidden_reason = 'moderation' then jsonb_build_object('state', 'hidden', 'reason',
      (select m.reason from public.moderation_actions m where m.target_user_id = p.id and m.action = 'hide_profile'
       order by m.created_at desc limit 1))
    when p.hidden_reason = 'minor_report' then jsonb_build_object('state', 'review')
  end
  from public.profiles p where p.id = (select auth.uid())
$$;

-- The reports I made (outcome and the motive written for me, nothing about the sanction) and the
-- decisions about me (the motive written for me, never who reported).
create function public.get_my_decisions()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'category', r.category,
        'target_type', r.target_type, 'status', r.status, 'decided_at', r.decided_at, 'reason', r.decision_reason)
        order by r.created_at desc)
      from public.reports r where r.reporter_id = (select auth.uid())), '[]'),
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'created_at', m.created_at, 'action', m.action,
        'reason', m.reason, 'ends_at', m.ends_at) order by m.created_at desc)
      from public.moderation_actions m
      where m.target_user_id = (select auth.uid())
        and m.action in ('warn', 'suspend', 'ban', 'unban', 'hide_profile', 'unhide_profile',
                         'revoke_good_conduct', 'text_remove')), '[]'))
$$;

------------------------------------------------------------------------------------------------
-- 7. A message removed by the Greffe is read as removed (body null)
------------------------------------------------------------------------------------------------
create or replace function public.get_messages(p_conversation uuid, p_after bigint default 0)
returns table (id bigint, kind public.message_kind, mine boolean, body text, payload jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations;
begin
  select * into c from public.conversations x where x.id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return query
    select m.id, m.kind,
      case when m.kind = 'text' then m.sender_id = me
           when m.system_payload ->> 'type' = 'note' then me = c.visitor_id
           else false end,
      case when m.removed_at is null then m.body::text end, m.system_payload, m.created_at
    from public.messages m
    where m.conversation_id = c.id and m.id > coalesce(p_after, 0)
    order by m.id
    limit 300;
end;
$$;

------------------------------------------------------------------------------------------------
-- 8. Rights
------------------------------------------------------------------------------------------------
revoke execute on function public.admin_report_queue(integer),
  public.admin_decide_report(bigint, boolean, text, public.moderation_action_type, text, integer),
  public.admin_flag_queue(integer), public.admin_decide_flag(bigint, text, text),
  public.admin_find_members(text), public.admin_member(uuid),
  public.admin_sanction(uuid, public.moderation_action_type, text, integer),
  public.admin_moderation_log(integer), public.get_my_sanction(), public.get_my_decisions()
  from public, anon;
grant execute on function public.admin_report_queue(integer),
  public.admin_decide_report(bigint, boolean, text, public.moderation_action_type, text, integer),
  public.admin_flag_queue(integer), public.admin_decide_flag(bigint, text, text),
  public.admin_find_members(text), public.admin_member(uuid),
  public.admin_sanction(uuid, public.moderation_action_type, text, integer),
  public.admin_moderation_log(integer), public.get_my_sanction(), public.get_my_decisions()
  to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261019130100', 'phase7a_moderation', array[$mig$-- Phase 7a: la modération (SPEC §10 DSA, §14, §15). Reports and flagged texts are decided by an
-- admin with a written motive; the reporter and the member concerned each receive their own
-- exposé des motifs (never the identity of the reporter, never the sanction of someone else).
-- Sanctions: warning, suspension (1 to 90 days), ban (e-mail fingerprint + Auth account banned,
-- sessions revoked), Fiche hidden, Bonne conduite withdrawn, text removed. Every admin function
-- checks is_admin() (second factor, aal2) first; moderation_actions stays append-only; the super
-- admin has no profile, so nothing here can reach them (Phase 5a-ter guards still apply).

------------------------------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------------------------------
-- The motive written for the reporter (the member concerned gets the one of moderation_actions).
alter table public.reports add column decision_reason varchar(1000);
alter table public.moderation_actions
  add column ends_at timestamptz,
  add column flag_id bigint references public.flagged_texts (id) on delete set null;
alter table public.flagged_texts
  add column decided_by uuid,
  add column decided_at timestamptz,
  add column decision_reason varchar(1000);
create index moderation_actions_recent on public.moderation_actions (created_at desc);
-- A message removed by the Greffe: its text is erased, the bubble says so.
alter table public.messages add column removed_at timestamptz;

------------------------------------------------------------------------------------------------
-- 2. Internal helpers (schema private, never exposed; invoker rights, called by the functions
--    below only)
------------------------------------------------------------------------------------------------
-- A motive is mandatory for every decision that reaches a member: 10 to 1,000 characters.
create function private.motive(p_text text)
returns text language plpgsql immutable set search_path = '' as $$
declare t text := btrim(coalesce(p_text, ''));
begin
  if char_length(t) < 10 or char_length(t) > 1000 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  return t;
end;
$$;

create function private.member_state(p public.profiles)
returns text language sql stable set search_path = '' as $$
  select case
    when p.banned_at is not null then 'banned'
    when p.suspended_until > now() then 'suspended'
    when p.hidden_reason is not null then 'hidden'
    when p.onboarding_completed_at is null then 'onboarding'
    else 'active' end
$$;

-- Closes every open case of a sanctioned member, so that nobody meets or writes to them meanwhile
-- (the close trigger cancels the visits, the Cavales and the conversations). The other one is told
-- neutrally: « Affaire classée » for a Visitor, the cancelled visit for a Bad.
create function private.close_cases_of(p_user uuid, p_reason public.case_close_reason)
returns void language plpgsql set search_path = '' as $$
begin
  perform public.notify(v.bad_id, 'visit_cancelled', jsonb_build_object('request_id', v.request_id, 'visit_id', v.id))
  from public.visits v where v.visitor_id = p_user and v.status = 'scheduled';
  with closed as (
    update public.visit_requests r
    set status = 'closed', close_reason = p_reason, closed_at = now(), choose_deadline = null, repropose_deadline = null
    where r.status in ('pending', 'accepted', 'released') and p_user in (r.visitor_id, r.bad_id)
    returning r.id, r.visitor_id, r.bad_id
  )
  insert into public.notifications (user_id, type, payload)
  select c.visitor_id, 'request_dismissed', jsonb_build_object('request_id', c.id)
  from closed c where c.bad_id = p_user;
end;
$$;

-- Who may be sanctioned: a member with a profile (so never the super admin), never oneself, and an
-- admin only by the super admin.
create function private.sanction_target(p_user uuid)
returns public.profiles language plpgsql set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = p_user for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_user = (select auth.uid()) then raise exception 'self_sanction' using errcode = '42501'; end if;
  if exists (select 1 from public.admin_users where user_id = p_user)
     and not exists (select 1 from public.super_admins where user_id = (select auth.uid())) then
    raise exception 'admin_protected' using errcode = '42501';
  end if;
  return p;
end;
$$;

-- Applies one sanction, records it (append-only) and tells the member concerned. A banned member
-- cannot sign in any more: the exposé des motifs also goes by e-mail (sent in Phase 7e).
create function private.apply_sanction(p_user uuid, p_action public.moderation_action_type, p_reason text,
  p_days integer, p_report bigint, p_flag bigint)
returns bigint language plpgsql set search_path = '' as $$
declare
  p public.profiles := private.sanction_target(p_user);
  ends timestamptz;
  address text;
  action_id bigint;
begin
  case p_action
    when 'warn', 'text_remove' then
      null;
    when 'suspend' then
      if p_days is null or p_days not between 1 and 90 then raise exception 'invalid_days' using errcode = '22023'; end if;
      ends := now() + make_interval(days => p_days);
      update public.profiles set suspended_until = greatest(coalesce(suspended_until, ends), ends) where id = p_user;
      perform private.close_cases_of(p_user, 'moderation');
    when 'ban' then
      if p.banned_at is not null then raise exception 'already_banned' using errcode = '23514'; end if;
      update public.profiles set banned_at = now() where id = p_user;
      select u.email into address from auth.users u where u.id = p_user;
      if address is not null then
        insert into public.banned_email_hashes (hash, expires_at)
        values (public.ban_email_hash(address),
                now() + make_interval(months => (select s.ban_hash_retention_months from public.app_settings s where s.id)))
        on conflict (hash) do update set banned_at = now(), expires_at = excluded.expires_at;
      end if;
      update auth.users set banned_until = now() + interval '100 years' where id = p_user;
      delete from auth.sessions where user_id = p_user;
      perform private.close_cases_of(p_user, 'banned');
    when 'unban' then
      -- Lifting a ban is reserved to the super admin.
      if not exists (select 1 from public.super_admins where user_id = (select auth.uid())) then
        raise exception 'super_admin_only' using errcode = '42501';
      end if;
      if p.banned_at is null then raise exception 'not_banned' using errcode = '23514'; end if;
      update public.profiles set banned_at = null where id = p_user;
      update auth.users set banned_until = null where id = p_user;
      select u.email into address from auth.users u where u.id = p_user;
      if address is not null then
        delete from public.banned_email_hashes where hash = public.ban_email_hash(address);
      end if;
    when 'hide_profile' then
      if p.hidden_reason = 'moderation' then raise exception 'already_hidden' using errcode = '23514'; end if;
      update public.profiles set hidden_reason = 'moderation' where id = p_user;
      perform private.close_cases_of(p_user, 'moderation');
    when 'unhide_profile' then
      if p.hidden_reason is null then raise exception 'not_hidden' using errcode = '23514'; end if;
      update public.profiles set hidden_reason = null where id = p_user;
    when 'revoke_good_conduct' then
      if not p.is_reglo then raise exception 'no_good_conduct' using errcode = '23514'; end if;
    else
      raise exception 'invalid_action' using errcode = '22023';
  end case;
  -- Bonne conduite goes at once with a report upheld, a suspension, a ban or a hidden Fiche (SPEC §14).
  if p_action in ('suspend', 'ban', 'hide_profile', 'revoke_good_conduct') or p_report is not null then
    update public.profiles set is_reglo = false where id = p_user and is_reglo;
  end if;
  insert into public.moderation_actions (target_user_id, action, reason, report_id, flag_id, admin_id, ends_at)
  values (p_user, p_action, p_reason, p_report, p_flag, (select auth.uid()), ends)
  returning id into action_id;
  perform public.notify(p_user, 'sanction', jsonb_build_object('action_id', action_id));
  if p_action = 'ban' then
    insert into public.email_outbox (user_id, kind, payload, priority)
    values (p_user, 'moderation_decision', jsonb_build_object('action_id', action_id), 10);
  end if;
  return action_id;
end;
$$;

revoke execute on function private.motive(text), private.member_state(public.profiles),
  private.close_cases_of(uuid, public.case_close_reason), private.sanction_target(uuid),
  private.apply_sanction(uuid, public.moderation_action_type, text, integer, bigint, bigint)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 3. Admin: the report queue and its decision
------------------------------------------------------------------------------------------------
-- Open reports, « mineur » first, then threats, harassment, scams, then the oldest. The reported
-- content itself is shown (the text, the photo), nothing more of the conversation.
create function public.admin_report_queue(p_limit integer default 50)
returns table (report_id bigint, created_at timestamptz, category public.report_category, comment text,
  target_type public.report_target, target_id text, target_user_id uuid, target_pseudo text,
  target_role public.member_role, target_state text, target_open_reports integer,
  target_upheld_reports integer, reporter_pseudo text, content text, photo_path text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select r.id, r.created_at, r.category, r.comment::text, r.target_type, r.target_id, r.target_user_id,
      t.pseudo::text, t.role, private.member_state(t),
      (select count(*)::integer from public.reports x where x.target_user_id = r.target_user_id and x.status = 'open'),
      (select count(*)::integer from public.reports x where x.target_user_id = r.target_user_id and x.status = 'upheld'),
      rp.pseudo::text,
      case r.target_type
        when 'profile' then t.bio::text
        when 'permit' then t.visit_motive::text
        when 'casier' then (select concat_ws(' / ', c.charge_1, c.charge_2, c.charge_3)
                            from public.casier_charges c where c.profile_id = t.id)
        when 'visit_request' then (select v.note::text from public.visit_requests v where v.id::text = r.target_id)
        when 'message' then (select m.body::text from public.messages m
                             where m.id::text = r.target_id and m.removed_at is null)
      end,
      case when r.target_type = 'photo' then
        (select ph.public_path_large from public.photos ph where ph.id::text = r.target_id) end
    from public.reports r
    left join public.profiles t on t.id = r.target_user_id
    left join public.profiles rp on rp.id = r.reporter_id
    where r.status = 'open'
    order by case r.category when 'minor' then 0 when 'violence_threat' then 1 when 'harassment' then 2
                             when 'scam' then 3 else 4 end,
             r.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- One decision per report: upheld (with a sanction and a motive for the member concerned) or
-- rejected; the reporter always gets a motive. A « mineur » hiding is lifted once no « mineur »
-- report on the member is still open and none was upheld.
create function public.admin_decide_report(p_report bigint, p_upheld boolean, p_reason_reporter text,
  p_action public.moderation_action_type default null, p_reason_target text default null,
  p_days integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reports; reporter_motive text;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found or r.target_user_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'open' then raise exception 'already_decided' using errcode = '23514'; end if;
  reporter_motive := private.motive(p_reason_reporter);
  if p_upheld then
    if p_action is null or p_action not in ('warn', 'suspend', 'ban', 'hide_profile') then
      raise exception 'invalid_action' using errcode = '22023';
    end if;
    perform private.apply_sanction(r.target_user_id, p_action, private.motive(p_reason_target), p_days, r.id, null);
  elsif p_action is not null then
    raise exception 'invalid_action' using errcode = '22023';
  elsif r.target_user_id = (select auth.uid()) then
    raise exception 'self_sanction' using errcode = '42501';
  end if;
  update public.reports
  set status = case when p_upheld then 'upheld'::public.report_status else 'rejected'::public.report_status end,
      decided_by = (select auth.uid()), decided_at = now(), decision_reason = reporter_motive
  where id = r.id;
  if not p_upheld and r.category = 'minor'
     and not exists (select 1 from public.reports x where x.target_user_id = r.target_user_id
                     and x.category = 'minor' and x.status in ('open', 'upheld')) then
    update public.profiles set hidden_reason = null where id = r.target_user_id and hidden_reason = 'minor_report';
  end if;
  if r.reporter_id is not null then
    perform public.notify(r.reporter_id, 'report_decided', jsonb_build_object('report_id', r.id));
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Admin: flagged texts (keywords)
------------------------------------------------------------------------------------------------
-- Texts the Greffe can erase itself; the others (pseudo, Motif de visite, Casier, place of a
-- Cavale) are upheld and dealt with by a sanction (the Fiche hidden until it is corrected).
create function private.removable_source(p_source public.flag_source)
returns boolean language sql immutable set search_path = '' as $$
  select p_source in ('bio', 'tribe_detail', 'visit_request', 'message')
$$;
revoke execute on function private.removable_source(public.flag_source) from public, anon, authenticated, service_role;

create function public.admin_flag_queue(p_limit integer default 50)
returns table (flag_id bigint, created_at timestamptz, source public.flag_source, excerpt text,
  matched_terms text[], user_id uuid, pseudo text, role public.member_role, state text, removable boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select f.id, f.created_at, f.source, f.excerpt, f.matched_terms, f.user_id, p.pseudo::text, p.role,
      private.member_state(p), private.removable_source(f.source)
    from public.flagged_texts f
    left join public.profiles p on p.id = f.user_id
    where f.status = 'open'
    order by f.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- 'clear': nothing wrong (the motive is optional, the member is not told);
-- 'uphold': the text breaks the rules, the admin sanctions from the member page;
-- 'remove': the text is erased and the member gets the motive.
create function public.admin_decide_flag(p_flag bigint, p_decision text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.flagged_texts; motive text;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into f from public.flagged_texts where id = p_flag for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if f.status <> 'open' then raise exception 'already_decided' using errcode = '23514'; end if;
  if p_decision = 'clear' then
    motive := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
    if f.user_id is not null then
      perform private.sanction_target(f.user_id);
      insert into public.moderation_actions (target_user_id, action, reason, flag_id, admin_id)
      values (f.user_id, 'text_clear', motive, f.id, (select auth.uid()));
    end if;
  elsif p_decision = 'uphold' then
    motive := private.motive(p_reason);
  elsif p_decision = 'remove' then
    motive := private.motive(p_reason);
    if not private.removable_source(f.source) then raise exception 'not_removable' using errcode = '23514'; end if;
    case f.source
      when 'bio' then
        update public.profiles set bio = null where id = f.user_id;
      when 'tribe_detail' then
        update public.profile_tribes set detail = null where profile_id = f.user_id and tribe_id::text = f.source_id;
      when 'visit_request' then
        update public.visit_requests set note = null where id::text = f.source_id;
        delete from public.messages m
        where m.kind = 'system' and m.system_payload ->> 'type' = 'note'
          and m.conversation_id in (select c.id from public.conversations c where c.request_id::text = f.source_id);
      when 'message' then
        update public.messages set body = '', removed_at = now() where id::text = f.source_id and kind = 'text';
    end case;
    if f.user_id is not null then
      perform private.apply_sanction(f.user_id, 'text_remove', motive, null, null, f.id);
    end if;
  else
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  update public.flagged_texts
  set status = case when p_decision = 'clear' then 'rejected'::public.report_status else 'upheld'::public.report_status end,
      decided_by = (select auth.uid()), decided_at = now(), decision_reason = motive
  where id = f.id;
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. Admin: members, sanctions, history
------------------------------------------------------------------------------------------------
-- By the start of the pseudo or the exact e-mail (never returned). Never by the N° d'écrou: no
-- function takes it as an input (PARCOURS-DESIGN §2).
create function public.admin_find_members(p_query text)
returns table (user_id uuid, pseudo text, role public.member_role, state text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(coalesce(p_query, ''));
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if char_length(q) < 2 or char_length(q) > 254 then return; end if;
  return query
    select p.id, p.pseudo::text, p.role, private.member_state(p), p.created_at
    from public.profiles p
    where p.pseudo::text ilike replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
       or p.id = (select u.id from auth.users u where lower(u.email) = lower(q) limit 1)
    order by p.pseudo
    limit 20;
end;
$$;

create function public.admin_member(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'id', p.id, 'pseudo', p.pseudo, 'role', p.role, 'gender', p.gender,
    'created_at', p.created_at, 'last_seen_at', p.last_seen_at, 'state', private.member_state(p),
    'suspended_until', case when p.suspended_until > now() then p.suspended_until end,
    'hidden_reason', p.hidden_reason, 'banned_at', p.banned_at, 'good_conduct', p.is_reglo,
    'is_admin', exists (select 1 from public.admin_users a where a.user_id = p.id),
    'zone', (select z.name from public.launch_zones z where z.id = p.zone_id),
    'reports_made', (select count(*) from public.reports r where r.reporter_id = p.id),
    'reports_received', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'category', r.category,
        'target_type', r.target_type, 'status', r.status, 'comment', r.comment, 'decision_reason', r.decision_reason)
        order by r.created_at desc)
      from public.reports r where r.target_user_id = p.id), '[]'),
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'created_at', m.created_at, 'action', m.action,
        'reason', m.reason, 'ends_at', m.ends_at, 'report_id', m.report_id) order by m.created_at desc)
      from public.moderation_actions m where m.target_user_id = p.id), '[]'),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'created_at', f.created_at, 'source', f.source,
        'excerpt', f.excerpt, 'status', f.status) order by f.created_at desc)
      from (select * from public.flagged_texts x where x.user_id = p.id order by x.created_at desc limit 20) f), '[]'));
end;
$$;

create function public.admin_sanction(p_user uuid, p_action public.moderation_action_type, p_reason text,
  p_days integer default null)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_action not in ('warn', 'suspend', 'ban', 'unban', 'hide_profile', 'unhide_profile', 'revoke_good_conduct') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  return private.apply_sanction(p_user, p_action, private.motive(p_reason), p_days, null, null);
end;
$$;

-- Historique des décisions: every action recorded, the newest first.
create function public.admin_moderation_log(p_limit integer default 100)
returns table (action_id bigint, created_at timestamptz, action public.moderation_action_type, reason text,
  ends_at timestamptz, target_user_id uuid, target_pseudo text, report_id bigint, flag_id bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select m.id, m.created_at, m.action, m.reason, m.ends_at, m.target_user_id, p.pseudo::text, m.report_id, m.flag_id
    from public.moderation_actions m
    left join public.profiles p on p.id = m.target_user_id
    where m.action not in ('photo_approve', 'photo_reject')
    order by m.created_at desc, m.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

------------------------------------------------------------------------------------------------
-- 6. Members: the exposé des motifs
------------------------------------------------------------------------------------------------
-- The sanction in force, if any (the screen shown instead of the site).
create function public.get_my_sanction()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when p.banned_at is not null then jsonb_build_object('state', 'banned', 'reason',
      (select m.reason from public.moderation_actions m where m.target_user_id = p.id and m.action = 'ban'
       order by m.created_at desc limit 1))
    when p.suspended_until > now() then jsonb_build_object('state', 'suspended', 'until', p.suspended_until, 'reason',
      (select m.reason from public.moderation_actions m where m.target_user_id = p.id and m.action = 'suspend'
       order by m.created_at desc limit 1))
    when p.hidden_reason = 'moderation' then jsonb_build_object('state', 'hidden', 'reason',
      (select m.reason from public.moderation_actions m where m.target_user_id = p.id and m.action = 'hide_profile'
       order by m.created_at desc limit 1))
    when p.hidden_reason = 'minor_report' then jsonb_build_object('state', 'review')
  end
  from public.profiles p where p.id = (select auth.uid())
$$;

-- The reports I made (outcome and the motive written for me, nothing about the sanction) and the
-- decisions about me (the motive written for me, never who reported).
create function public.get_my_decisions()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'category', r.category,
        'target_type', r.target_type, 'status', r.status, 'decided_at', r.decided_at, 'reason', r.decision_reason)
        order by r.created_at desc)
      from public.reports r where r.reporter_id = (select auth.uid())), '[]'),
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'created_at', m.created_at, 'action', m.action,
        'reason', m.reason, 'ends_at', m.ends_at) order by m.created_at desc)
      from public.moderation_actions m
      where m.target_user_id = (select auth.uid())
        and m.action in ('warn', 'suspend', 'ban', 'unban', 'hide_profile', 'unhide_profile',
                         'revoke_good_conduct', 'text_remove')), '[]'))
$$;

------------------------------------------------------------------------------------------------
-- 7. A message removed by the Greffe is read as removed (body null)
------------------------------------------------------------------------------------------------
create or replace function public.get_messages(p_conversation uuid, p_after bigint default 0)
returns table (id bigint, kind public.message_kind, mine boolean, body text, payload jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations;
begin
  select * into c from public.conversations x where x.id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return query
    select m.id, m.kind,
      case when m.kind = 'text' then m.sender_id = me
           when m.system_payload ->> 'type' = 'note' then me = c.visitor_id
           else false end,
      case when m.removed_at is null then m.body::text end, m.system_payload, m.created_at
    from public.messages m
    where m.conversation_id = c.id and m.id > coalesce(p_after, 0)
    order by m.id
    limit 300;
end;
$$;

------------------------------------------------------------------------------------------------
-- 8. Rights
------------------------------------------------------------------------------------------------
revoke execute on function public.admin_report_queue(integer),
  public.admin_decide_report(bigint, boolean, text, public.moderation_action_type, text, integer),
  public.admin_flag_queue(integer), public.admin_decide_flag(bigint, text, text),
  public.admin_find_members(text), public.admin_member(uuid),
  public.admin_sanction(uuid, public.moderation_action_type, text, integer),
  public.admin_moderation_log(integer), public.get_my_sanction(), public.get_my_decisions()
  from public, anon;
grant execute on function public.admin_report_queue(integer),
  public.admin_decide_report(bigint, boolean, text, public.moderation_action_type, text, integer),
  public.admin_flag_queue(integer), public.admin_decide_flag(bigint, text, text),
  public.admin_find_members(text), public.admin_member(uuid),
  public.admin_sanction(uuid, public.moderation_action_type, text, integer),
  public.admin_moderation_log(integer), public.get_my_sanction(), public.get_my_decisions()
  to authenticated;
$mig$]);

-- ===== 20261020090000_phase7b_pilotage.sql =====
-- Phase 7b: le pilotage (SPEC §3, §15). Quartiers and their thresholds, Signes distinctifs,
-- moderation keywords, questions of the Interrogatoire, and the health dashboard of a quartier,
-- computed from our own tables only (no third-party tool), seed accounts left out. Every function
-- checks is_admin() (second factor, aal2) first. Days of activity are kept for retention (J7, J30).

------------------------------------------------------------------------------------------------
-- 1. Days of activity (retention): one row per member and per day (Paris), nothing else
------------------------------------------------------------------------------------------------
create table public.activity_days (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
alter table public.activity_days enable row level security;
revoke all on public.activity_days from public, anon, authenticated;

-- Last activity, at most one write per hour, and the day of activity with it.
create or replace function public.touch_activity()
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  update public.profiles set last_seen_at = now()
  where id = me and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
  if found then
    insert into public.activity_days (user_id, day)
    values (me, (now() at time zone 'Europe/Paris')::date)
    on conflict do nothing;
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. Quartiers
------------------------------------------------------------------------------------------------
-- Gauge of one quartier (same counting as zone_progress, SPEC §3).
create function private.zone_gauge(p_zone smallint)
returns jsonb language sql stable set search_path = '' as $$
  with z as (
    select z.*, ceil(z.threshold_bads * z.threshold_women_pct / 100.0)::integer as min_girls,
      ceil(z.threshold_bads * z.threshold_men_pct / 100.0)::integer as min_boys
    from public.launch_zones z where z.id = p_zone
  ), bads as (
    select count(*)::integer as total,
      (count(*) filter (where p.gender = 'woman'))::integer as girls,
      (count(*) filter (where p.gender = 'man'))::integer as boys
    from public.profiles p where p.zone_id = p_zone and public.counts_for_zone(p)
  ), visitors as (
    select count(*)::integer as waiting
    from public.profiles p
    where p.zone_id = p_zone and p.role = 'visitor' and p.onboarding_completed_at is not null
      and p.banned_at is null and p.hidden_reason is null and not p.is_seed
      and exists (select 1 from public.photos ph where ph.owner_id = p.id and ph.position = 0 and ph.status = 'approved')
  )
  select jsonb_build_object('bads', bads.total, 'threshold_bads', z.threshold_bads,
    'bad_girls', bads.girls, 'min_bad_girls', z.min_girls, 'bad_boys', bads.boys, 'min_bad_boys', z.min_boys,
    'visitors_waiting', visitors.waiting,
    'ready', bads.total >= z.threshold_bads and bads.girls >= z.min_girls and bads.boys >= z.min_boys)
  from z, bads, visitors
$$;
revoke execute on function private.zone_gauge(smallint) from public, anon, authenticated, service_role;

create function public.admin_zones()
returns table (zone_id smallint, slug text, name text, center_place_id bigint, center_name text,
  radius_km smallint, timezone text, status public.zone_status, threshold_bads integer,
  threshold_women_pct smallint, threshold_men_pct smallint, auto_open boolean, ready_at timestamptz,
  opened_at timestamptz, gauge jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select z.id, z.slug, z.name, z.center_place_id, pl.name, z.radius_km, z.timezone, z.status,
      z.threshold_bads, z.threshold_women_pct, z.threshold_men_pct, z.auto_open, z.ready_at, z.opened_at,
      private.zone_gauge(z.id)
    from public.launch_zones z join public.places pl on pl.id = z.center_place_id
    order by z.name;
end;
$$;

-- Creates (p_zone null) or changes a quartier. Its members' zone is recomputed by the trigger when
-- the centre or the radius changes. The status is changed by admin_set_zone_status only.
create function public.admin_save_zone(p_slug text, p_name text, p_center_place bigint,
  p_radius_km smallint, p_timezone text, p_threshold_bads integer, p_women_pct smallint,
  p_men_pct smallint, p_auto_open boolean, p_zone smallint default null)
returns smallint language plpgsql security definer set search_path = '' as $$
declare saved smallint; zone_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if char_length(zone_name) not between 2 and 60 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9-]{2,40}$' then raise exception 'invalid_slug' using errcode = '22023'; end if;
  if not exists (select 1 from public.places where id = p_center_place) then
    raise exception 'invalid_place' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  if p_radius_km is null or p_radius_km not between 5 and 200
     or p_threshold_bads is null or p_threshold_bads not between 1 and 100000
     or p_women_pct is null or p_women_pct not between 0 and 100
     or p_men_pct is null or p_men_pct not between 0 and 100 or p_women_pct + p_men_pct > 100 then
    raise exception 'invalid_thresholds' using errcode = '22023';
  end if;
  if p_zone is null then
    insert into public.launch_zones (slug, name, center_place_id, radius_km, timezone, threshold_bads,
      threshold_women_pct, threshold_men_pct, auto_open)
    values (p_slug, zone_name, p_center_place, p_radius_km, p_timezone, p_threshold_bads, p_women_pct, p_men_pct,
      coalesce(p_auto_open, false))
    returning id into saved;
  else
    update public.launch_zones
    set slug = p_slug, name = zone_name, center_place_id = p_center_place, radius_km = p_radius_km,
        timezone = p_timezone, threshold_bads = p_threshold_bads, threshold_women_pct = p_women_pct,
        threshold_men_pct = p_men_pct, auto_open = coalesce(p_auto_open, false)
    where id = p_zone
    returning id into saved;
    if saved is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return saved;
exception when unique_violation then
  raise exception 'slug_taken' using errcode = '23505';
end;
$$;

-- Opens a quartier to visits (its members are told: notification, and e-mail sent in Phase 7e) or
-- puts it back on the waiting list. An open quartier never closes by itself (SPEC §3).
create function public.admin_set_zone_status(p_zone smallint, p_status public.zone_status)
returns void language plpgsql security definer set search_path = '' as $$
declare z public.launch_zones;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into z from public.launch_zones where id = p_zone for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if z.status = p_status then raise exception 'same_status' using errcode = '23514'; end if;
  update public.launch_zones
  set status = p_status, opened_at = case when p_status = 'open' then now() else opened_at end
  where id = p_zone;
  if p_status = 'open' then
    insert into public.notifications (user_id, type, payload)
    select p.id, 'zone_opened', jsonb_build_object('zone_id', p_zone)
    from public.profiles p
    where p.zone_id = p_zone and p.onboarding_completed_at is not null and p.banned_at is null and not p.is_seed;
    insert into public.email_outbox (user_id, kind, payload, priority)
    select p.id, 'zone_opened', jsonb_build_object('zone_id', p_zone), 40
    from public.profiles p
    where p.zone_id = p_zone and p.onboarding_completed_at is not null and p.banned_at is null and not p.is_seed;
  end if;
end;
$$;

create function public.admin_launch_mode()
returns public.launch_mode language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return (select s.launch_mode from public.app_settings s where s.id);
end;
$$;

-- The global mode (SPEC §3: « open » switches the quartier mechanism off). Super admin only.
create function public.admin_set_launch_mode(p_mode public.launch_mode)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if not exists (select 1 from public.super_admins where user_id = (select auth.uid())) then
    raise exception 'super_admin_only' using errcode = '42501';
  end if;
  update public.app_settings set launch_mode = p_mode, updated_at = now() where id;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. Signes distinctifs, keywords, questions
------------------------------------------------------------------------------------------------
create function public.admin_tribes()
returns table (tribe_id smallint, slug text, label_fr text, label_en text, sort smallint, is_active boolean, members integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select t.id, t.slug, t.label ->> 'fr', t.label ->> 'en', t.sort, t.is_active,
      (select count(*)::integer from public.profile_tribes pt where pt.tribe_id = t.id)
    from public.tribes t order by t.sort, t.id;
end;
$$;

-- A Signe is never removed (members keep it): it is deactivated.
create function public.admin_save_tribe(p_slug text, p_label_fr text, p_label_en text,
  p_sort smallint, p_active boolean, p_tribe smallint default null)
returns smallint language plpgsql security definer set search_path = '' as $$
declare saved smallint; fr text := btrim(coalesce(p_label_fr, '')); en text := btrim(coalesce(p_label_en, ''));
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9-]{2,40}$' then raise exception 'invalid_slug' using errcode = '22023'; end if;
  if char_length(fr) not between 2 and 40 or char_length(en) not between 2 and 40 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  if p_tribe is null then
    insert into public.tribes (slug, label, sort, is_active)
    values (p_slug, jsonb_build_object('fr', fr, 'en', en), coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into saved;
  else
    update public.tribes set slug = p_slug, label = jsonb_build_object('fr', fr, 'en', en),
      sort = coalesce(p_sort, 0), is_active = coalesce(p_active, true)
    where id = p_tribe returning id into saved;
    if saved is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return saved;
exception when unique_violation then
  raise exception 'slug_taken' using errcode = '23505';
end;
$$;

create function public.admin_keywords()
returns table (keyword_id integer, term text, lang char(2), category public.report_category, is_active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query select k.id, k.term, k.lang, k.category, k.is_active from public.moderation_keywords k
    order by k.lang, k.term;
end;
$$;

-- A keyword is deactivated, never removed (flagged texts keep the words they matched).
create function public.admin_save_keyword(p_term text, p_lang text,
  p_category public.report_category, p_active boolean, p_keyword integer default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare saved integer; t text := lower(btrim(coalesce(p_term, '')));
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if char_length(t) not between 2 and 60 then raise exception 'invalid_term' using errcode = '22023'; end if;
  if p_lang is null or p_lang not in ('fr', 'en') or p_category is null then
    raise exception 'invalid_keyword' using errcode = '22023';
  end if;
  if p_keyword is null then
    insert into public.moderation_keywords (term, lang, category, is_active)
    values (t, p_lang, p_category, coalesce(p_active, true)) returning id into saved;
  else
    update public.moderation_keywords set term = t, lang = p_lang, category = p_category,
      is_active = coalesce(p_active, true)
    where id = p_keyword returning id into saved;
    if saved is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return saved;
exception when unique_violation then
  raise exception 'keyword_taken' using errcode = '23505';
end;
$$;

create function public.admin_questions()
returns table (question_id smallint, sort_position smallint, phase public.question_phase, label_fr text,
  label_en text, is_active boolean, options jsonb, answers integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select q.id, q.position, q.phase, q.label ->> 'fr', q.label ->> 'en', q.is_active,
      coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'fr', o.label ->> 'fr', 'en', o.label ->> 'en')
                order by o.position) from public.question_options o where o.question_id = q.id), '[]'),
      (select count(*)::integer from public.answers a where a.question_id = q.id)
    from public.questions q order by q.position;
end;
$$;

-- Wording only (a typo, a translation): the answers keep their meaning, so no question or option
-- is added or removed here. Only an « extra » question can be deactivated: the 10 core questions
-- are required by the onboarding and by the indice de complicité.
create function public.admin_save_question(p_question smallint, p_label_fr text, p_label_en text,
  p_active boolean, p_options jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.questions; o jsonb;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into q from public.questions where id = p_question for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if char_length(btrim(coalesce(p_label_fr, ''))) not between 5 and 200
     or char_length(btrim(coalesce(p_label_en, ''))) not between 5 and 200 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  if q.phase = 'core' and not coalesce(p_active, true) then
    raise exception 'core_question' using errcode = '23514';
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array'
     or jsonb_array_length(p_options) <> (select count(*) from public.question_options where question_id = q.id) then
    raise exception 'invalid_options' using errcode = '22023';
  end if;
  for o in select * from jsonb_array_elements(p_options) loop
    if char_length(btrim(coalesce(o ->> 'fr', ''))) not between 1 and 120
       or char_length(btrim(coalesce(o ->> 'en', ''))) not between 1 and 120
       or not exists (select 1 from public.question_options x where x.question_id = q.id and x.id::text = o ->> 'id') then
      raise exception 'invalid_options' using errcode = '22023';
    end if;
    update public.question_options
    set label = jsonb_build_object('fr', btrim(o ->> 'fr'), 'en', btrim(o ->> 'en'))
    where question_id = q.id and id::text = o ->> 'id';
  end loop;
  update public.questions
  set label = jsonb_build_object('fr', btrim(p_label_fr), 'en', btrim(p_label_en)), is_active = coalesce(p_active, true)
  where id = q.id;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Tableau de santé d'un quartier (SPEC §15), over a period of days (Paris), seeds left out
------------------------------------------------------------------------------------------------
create function public.admin_zone_health(p_zone smallint, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz;
  until timestamptz;
  days integer;
  result jsonb;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if not exists (select 1 from public.launch_zones where id = p_zone) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  since := p_from::timestamp at time zone 'Europe/Paris';
  until := (p_to + 1)::timestamp at time zone 'Europe/Paris';
  days := p_to - p_from + 1;

  with members as (
    select p.* from public.profiles p where p.zone_id = p_zone and not p.is_seed
  ), requests as (
    select r.*, exists (select 1 from public.visit_slots s where s.request_id = r.id) as accepted
    from public.visit_requests r join members v on v.id = r.visitor_id
    where r.created_at >= since and r.created_at < until
  ), decided as (
    select * from requests where accepted or close_reason = 'dismissed_by_bad'
  ), started as (
    select x.* from public.visits x join members v on v.id = x.visitor_id
    where x.starts_at >= since and x.starts_at < until and x.status in ('ended', 'no_show')
  ), dates as (
    select d.* from public.date_proposals d
    join public.conversations c on c.id = d.conversation_id
    join members v on v.id = c.visitor_id
    where d.created_at >= since and d.created_at < until
  ), served as (
    select pp.visitor_id, pp.promenade_date, count(*) as picks
    from public.promenade_picks pp join members v on v.id = pp.visitor_id
    where pp.promenade_date between p_from and p_to
    group by pp.visitor_id, pp.promenade_date
  ), cohort as (
    select m.id, m.role, m.created_at from members m
    where m.onboarding_completed_at is not null and m.created_at >= since and m.created_at < until
  ), zone_reports as (
    select r.* from public.reports r join members t on t.id = r.target_user_id
    where r.created_at >= since and r.created_at < until
  ), zone_photos as (
    select ph.* from public.photos ph join members o on o.id = ph.owner_id
    where ph.reviewed_at >= since and ph.reviewed_at < until
  ), pushes as (
    select o.status from public.push_outbox o join members m on m.id = o.user_id
    where o.created_at >= since and o.created_at < until and o.status in ('sent', 'failed')
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'days', days),
    'gauge', private.zone_gauge(p_zone),
    'members', jsonb_build_object(
      'signed_up', (select count(*) from members m where m.created_at >= since and m.created_at < until),
      'by_role_gender', coalesce((select jsonb_object_agg(k, n) from (
          select coalesce(m.role::text, 'none') || ':' || coalesce(m.gender::text, 'none') as k, count(*) as n
          from members m group by 1) g), '{}'),
      'complete', (select jsonb_build_object(
          'dossiers', count(*) filter (where m.role = 'bad' and m.onboarding_completed_at is not null),
          'permits', count(*) filter (where m.role = 'visitor' and m.onboarding_completed_at is not null))
        from members m)),
    'requests', (select jsonb_build_object(
        'sent', count(*),
        'per_day', round(count(*)::numeric / days, 1),
        'auto_closed', count(*) filter (where status = 'auto_dismissed'),
        'decided', (select count(*) from decided),
        'accepted', (select count(*) from decided where accepted),
        'accepted_right_bet', (select count(*) from decided where accepted and guess_correct),
        'decided_right_bet', (select count(*) from decided where guess_correct),
        'accepted_wrong_bet', (select count(*) from decided where accepted and not guess_correct),
        'decided_wrong_bet', (select count(*) from decided where not guess_correct),
        'avg_response_hours', (select round((avg(extract(epoch from decided_at - created_at)) / 3600)::numeric, 1)
                               from decided where decided_at is not null),
        'with_visit', (select count(*) from requests r where r.accepted
                       and exists (select 1 from public.visits x where x.request_id = r.id)),
        'slots_declined', (select count(*) from requests r where r.accepted and r.slots_declined))
      from requests),
    'visits', (select jsonb_build_object(
        'started', count(*),
        'bad_present', count(*) filter (where bad_joined_at is not null),
        'visitor_present', count(*) filter (where visitor_joined_at is not null),
        'both_present', count(*) filter (where bad_joined_at is not null and visitor_joined_at is not null),
        'released', count(*) filter (where outcome = 'released'),
        'late_cancellations', (select count(*) from public.visits x join members v on v.id = x.visitor_id
                               where x.starts_at >= since and x.starts_at < until and x.cancelled_late))
      from started),
    'cavales', (select jsonb_build_object(
        'proposed', count(*),
        'accepted', count(*) filter (where status = 'accepted' or (status = 'cancelled' and responded_at is not null)))
      from dates),
    'promenade', (select jsonb_build_object(
        'visitor_days', count(*),
        'under_five', count(*) filter (where picks < 5))
      from served),
    'retention', (select jsonb_object_agg(role, jsonb_build_object(
        'cohort_d7', d7_cohort, 'back_d7', d7_back, 'cohort_d30', d30_cohort, 'back_d30', d30_back))
      from (
        select coalesce(c.role::text, 'none') as role,
          count(*) filter (where c.created_at <= now() - interval '7 days') as d7_cohort,
          count(*) filter (where c.created_at <= now() - interval '7 days' and exists (
            select 1 from public.activity_days a where a.user_id = c.id
              and a.day >= ((c.created_at + interval '7 days') at time zone 'Europe/Paris')::date)) as d7_back,
          count(*) filter (where c.created_at <= now() - interval '30 days') as d30_cohort,
          count(*) filter (where c.created_at <= now() - interval '30 days' and exists (
            select 1 from public.activity_days a where a.user_id = c.id
              and a.day >= ((c.created_at + interval '30 days') at time zone 'Europe/Paris')::date)) as d30_back
        from cohort c group by 1) r),
    'moderation', jsonb_build_object(
      'reports', (select count(*) from zone_reports),
      'avg_report_hours', (select round((avg(extract(epoch from decided_at - created_at)) / 3600)::numeric, 1)
                           from zone_reports where decided_at is not null),
      'photos_reviewed', (select count(*) from zone_photos),
      'avg_greffe_hours', (select round((avg(extract(epoch from reviewed_at - created_at)) / 3600)::numeric, 1)
                           from zone_photos)),
    'push', jsonb_build_object(
      'members', (select count(*) from members m where m.onboarding_completed_at is not null),
      'subscribed', (select count(*) from members m where m.onboarding_completed_at is not null
                     and exists (select 1 from public.push_subscriptions s where s.user_id = m.id and s.revoked_at is null)),
      'sent', (select count(*) from pushes where status = 'sent'),
      'failed', (select count(*) from pushes where status = 'failed'))
  ) into result;
  return result;
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. Rights
------------------------------------------------------------------------------------------------
revoke execute on function public.admin_zones(),
  public.admin_save_zone(text, text, bigint, smallint, text, integer, smallint, smallint, boolean, smallint),
  public.admin_set_zone_status(smallint, public.zone_status), public.admin_launch_mode(),
  public.admin_set_launch_mode(public.launch_mode),
  public.admin_tribes(), public.admin_save_tribe(text, text, text, smallint, boolean, smallint),
  public.admin_keywords(), public.admin_save_keyword(text, text, public.report_category, boolean, integer),
  public.admin_questions(), public.admin_save_question(smallint, text, text, boolean, jsonb),
  public.admin_zone_health(smallint, date, date)
  from public, anon;
grant execute on function public.admin_zones(),
  public.admin_save_zone(text, text, bigint, smallint, text, integer, smallint, smallint, boolean, smallint),
  public.admin_set_zone_status(smallint, public.zone_status), public.admin_launch_mode(),
  public.admin_set_launch_mode(public.launch_mode),
  public.admin_tribes(), public.admin_save_tribe(text, text, text, smallint, boolean, smallint),
  public.admin_keywords(), public.admin_save_keyword(text, text, public.report_category, boolean, integer),
  public.admin_questions(), public.admin_save_question(smallint, text, text, boolean, jsonb),
  public.admin_zone_health(smallint, date, date)
  to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261020090000', 'phase7b_pilotage', array[$mig$-- Phase 7b: le pilotage (SPEC §3, §15). Quartiers and their thresholds, Signes distinctifs,
-- moderation keywords, questions of the Interrogatoire, and the health dashboard of a quartier,
-- computed from our own tables only (no third-party tool), seed accounts left out. Every function
-- checks is_admin() (second factor, aal2) first. Days of activity are kept for retention (J7, J30).

------------------------------------------------------------------------------------------------
-- 1. Days of activity (retention): one row per member and per day (Paris), nothing else
------------------------------------------------------------------------------------------------
create table public.activity_days (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
alter table public.activity_days enable row level security;
revoke all on public.activity_days from public, anon, authenticated;

-- Last activity, at most one write per hour, and the day of activity with it.
create or replace function public.touch_activity()
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  update public.profiles set last_seen_at = now()
  where id = me and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
  if found then
    insert into public.activity_days (user_id, day)
    values (me, (now() at time zone 'Europe/Paris')::date)
    on conflict do nothing;
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. Quartiers
------------------------------------------------------------------------------------------------
-- Gauge of one quartier (same counting as zone_progress, SPEC §3).
create function private.zone_gauge(p_zone smallint)
returns jsonb language sql stable set search_path = '' as $$
  with z as (
    select z.*, ceil(z.threshold_bads * z.threshold_women_pct / 100.0)::integer as min_girls,
      ceil(z.threshold_bads * z.threshold_men_pct / 100.0)::integer as min_boys
    from public.launch_zones z where z.id = p_zone
  ), bads as (
    select count(*)::integer as total,
      (count(*) filter (where p.gender = 'woman'))::integer as girls,
      (count(*) filter (where p.gender = 'man'))::integer as boys
    from public.profiles p where p.zone_id = p_zone and public.counts_for_zone(p)
  ), visitors as (
    select count(*)::integer as waiting
    from public.profiles p
    where p.zone_id = p_zone and p.role = 'visitor' and p.onboarding_completed_at is not null
      and p.banned_at is null and p.hidden_reason is null and not p.is_seed
      and exists (select 1 from public.photos ph where ph.owner_id = p.id and ph.position = 0 and ph.status = 'approved')
  )
  select jsonb_build_object('bads', bads.total, 'threshold_bads', z.threshold_bads,
    'bad_girls', bads.girls, 'min_bad_girls', z.min_girls, 'bad_boys', bads.boys, 'min_bad_boys', z.min_boys,
    'visitors_waiting', visitors.waiting,
    'ready', bads.total >= z.threshold_bads and bads.girls >= z.min_girls and bads.boys >= z.min_boys)
  from z, bads, visitors
$$;
revoke execute on function private.zone_gauge(smallint) from public, anon, authenticated, service_role;

create function public.admin_zones()
returns table (zone_id smallint, slug text, name text, center_place_id bigint, center_name text,
  radius_km smallint, timezone text, status public.zone_status, threshold_bads integer,
  threshold_women_pct smallint, threshold_men_pct smallint, auto_open boolean, ready_at timestamptz,
  opened_at timestamptz, gauge jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select z.id, z.slug, z.name, z.center_place_id, pl.name, z.radius_km, z.timezone, z.status,
      z.threshold_bads, z.threshold_women_pct, z.threshold_men_pct, z.auto_open, z.ready_at, z.opened_at,
      private.zone_gauge(z.id)
    from public.launch_zones z join public.places pl on pl.id = z.center_place_id
    order by z.name;
end;
$$;

-- Creates (p_zone null) or changes a quartier. Its members' zone is recomputed by the trigger when
-- the centre or the radius changes. The status is changed by admin_set_zone_status only.
create function public.admin_save_zone(p_slug text, p_name text, p_center_place bigint,
  p_radius_km smallint, p_timezone text, p_threshold_bads integer, p_women_pct smallint,
  p_men_pct smallint, p_auto_open boolean, p_zone smallint default null)
returns smallint language plpgsql security definer set search_path = '' as $$
declare saved smallint; zone_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if char_length(zone_name) not between 2 and 60 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9-]{2,40}$' then raise exception 'invalid_slug' using errcode = '22023'; end if;
  if not exists (select 1 from public.places where id = p_center_place) then
    raise exception 'invalid_place' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  if p_radius_km is null or p_radius_km not between 5 and 200
     or p_threshold_bads is null or p_threshold_bads not between 1 and 100000
     or p_women_pct is null or p_women_pct not between 0 and 100
     or p_men_pct is null or p_men_pct not between 0 and 100 or p_women_pct + p_men_pct > 100 then
    raise exception 'invalid_thresholds' using errcode = '22023';
  end if;
  if p_zone is null then
    insert into public.launch_zones (slug, name, center_place_id, radius_km, timezone, threshold_bads,
      threshold_women_pct, threshold_men_pct, auto_open)
    values (p_slug, zone_name, p_center_place, p_radius_km, p_timezone, p_threshold_bads, p_women_pct, p_men_pct,
      coalesce(p_auto_open, false))
    returning id into saved;
  else
    update public.launch_zones
    set slug = p_slug, name = zone_name, center_place_id = p_center_place, radius_km = p_radius_km,
        timezone = p_timezone, threshold_bads = p_threshold_bads, threshold_women_pct = p_women_pct,
        threshold_men_pct = p_men_pct, auto_open = coalesce(p_auto_open, false)
    where id = p_zone
    returning id into saved;
    if saved is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return saved;
exception when unique_violation then
  raise exception 'slug_taken' using errcode = '23505';
end;
$$;

-- Opens a quartier to visits (its members are told: notification, and e-mail sent in Phase 7e) or
-- puts it back on the waiting list. An open quartier never closes by itself (SPEC §3).
create function public.admin_set_zone_status(p_zone smallint, p_status public.zone_status)
returns void language plpgsql security definer set search_path = '' as $$
declare z public.launch_zones;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into z from public.launch_zones where id = p_zone for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if z.status = p_status then raise exception 'same_status' using errcode = '23514'; end if;
  update public.launch_zones
  set status = p_status, opened_at = case when p_status = 'open' then now() else opened_at end
  where id = p_zone;
  if p_status = 'open' then
    insert into public.notifications (user_id, type, payload)
    select p.id, 'zone_opened', jsonb_build_object('zone_id', p_zone)
    from public.profiles p
    where p.zone_id = p_zone and p.onboarding_completed_at is not null and p.banned_at is null and not p.is_seed;
    insert into public.email_outbox (user_id, kind, payload, priority)
    select p.id, 'zone_opened', jsonb_build_object('zone_id', p_zone), 40
    from public.profiles p
    where p.zone_id = p_zone and p.onboarding_completed_at is not null and p.banned_at is null and not p.is_seed;
  end if;
end;
$$;

create function public.admin_launch_mode()
returns public.launch_mode language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return (select s.launch_mode from public.app_settings s where s.id);
end;
$$;

-- The global mode (SPEC §3: « open » switches the quartier mechanism off). Super admin only.
create function public.admin_set_launch_mode(p_mode public.launch_mode)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if not exists (select 1 from public.super_admins where user_id = (select auth.uid())) then
    raise exception 'super_admin_only' using errcode = '42501';
  end if;
  update public.app_settings set launch_mode = p_mode, updated_at = now() where id;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. Signes distinctifs, keywords, questions
------------------------------------------------------------------------------------------------
create function public.admin_tribes()
returns table (tribe_id smallint, slug text, label_fr text, label_en text, sort smallint, is_active boolean, members integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select t.id, t.slug, t.label ->> 'fr', t.label ->> 'en', t.sort, t.is_active,
      (select count(*)::integer from public.profile_tribes pt where pt.tribe_id = t.id)
    from public.tribes t order by t.sort, t.id;
end;
$$;

-- A Signe is never removed (members keep it): it is deactivated.
create function public.admin_save_tribe(p_slug text, p_label_fr text, p_label_en text,
  p_sort smallint, p_active boolean, p_tribe smallint default null)
returns smallint language plpgsql security definer set search_path = '' as $$
declare saved smallint; fr text := btrim(coalesce(p_label_fr, '')); en text := btrim(coalesce(p_label_en, ''));
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9-]{2,40}$' then raise exception 'invalid_slug' using errcode = '22023'; end if;
  if char_length(fr) not between 2 and 40 or char_length(en) not between 2 and 40 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  if p_tribe is null then
    insert into public.tribes (slug, label, sort, is_active)
    values (p_slug, jsonb_build_object('fr', fr, 'en', en), coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into saved;
  else
    update public.tribes set slug = p_slug, label = jsonb_build_object('fr', fr, 'en', en),
      sort = coalesce(p_sort, 0), is_active = coalesce(p_active, true)
    where id = p_tribe returning id into saved;
    if saved is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return saved;
exception when unique_violation then
  raise exception 'slug_taken' using errcode = '23505';
end;
$$;

create function public.admin_keywords()
returns table (keyword_id integer, term text, lang char(2), category public.report_category, is_active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query select k.id, k.term, k.lang, k.category, k.is_active from public.moderation_keywords k
    order by k.lang, k.term;
end;
$$;

-- A keyword is deactivated, never removed (flagged texts keep the words they matched).
create function public.admin_save_keyword(p_term text, p_lang text,
  p_category public.report_category, p_active boolean, p_keyword integer default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare saved integer; t text := lower(btrim(coalesce(p_term, '')));
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if char_length(t) not between 2 and 60 then raise exception 'invalid_term' using errcode = '22023'; end if;
  if p_lang is null or p_lang not in ('fr', 'en') or p_category is null then
    raise exception 'invalid_keyword' using errcode = '22023';
  end if;
  if p_keyword is null then
    insert into public.moderation_keywords (term, lang, category, is_active)
    values (t, p_lang, p_category, coalesce(p_active, true)) returning id into saved;
  else
    update public.moderation_keywords set term = t, lang = p_lang, category = p_category,
      is_active = coalesce(p_active, true)
    where id = p_keyword returning id into saved;
    if saved is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return saved;
exception when unique_violation then
  raise exception 'keyword_taken' using errcode = '23505';
end;
$$;

create function public.admin_questions()
returns table (question_id smallint, sort_position smallint, phase public.question_phase, label_fr text,
  label_en text, is_active boolean, options jsonb, answers integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select q.id, q.position, q.phase, q.label ->> 'fr', q.label ->> 'en', q.is_active,
      coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'fr', o.label ->> 'fr', 'en', o.label ->> 'en')
                order by o.position) from public.question_options o where o.question_id = q.id), '[]'),
      (select count(*)::integer from public.answers a where a.question_id = q.id)
    from public.questions q order by q.position;
end;
$$;

-- Wording only (a typo, a translation): the answers keep their meaning, so no question or option
-- is added or removed here. Only an « extra » question can be deactivated: the 10 core questions
-- are required by the onboarding and by the indice de complicité.
create function public.admin_save_question(p_question smallint, p_label_fr text, p_label_en text,
  p_active boolean, p_options jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.questions; o jsonb;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into q from public.questions where id = p_question for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if char_length(btrim(coalesce(p_label_fr, ''))) not between 5 and 200
     or char_length(btrim(coalesce(p_label_en, ''))) not between 5 and 200 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  if q.phase = 'core' and not coalesce(p_active, true) then
    raise exception 'core_question' using errcode = '23514';
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array'
     or jsonb_array_length(p_options) <> (select count(*) from public.question_options where question_id = q.id) then
    raise exception 'invalid_options' using errcode = '22023';
  end if;
  for o in select * from jsonb_array_elements(p_options) loop
    if char_length(btrim(coalesce(o ->> 'fr', ''))) not between 1 and 120
       or char_length(btrim(coalesce(o ->> 'en', ''))) not between 1 and 120
       or not exists (select 1 from public.question_options x where x.question_id = q.id and x.id::text = o ->> 'id') then
      raise exception 'invalid_options' using errcode = '22023';
    end if;
    update public.question_options
    set label = jsonb_build_object('fr', btrim(o ->> 'fr'), 'en', btrim(o ->> 'en'))
    where question_id = q.id and id::text = o ->> 'id';
  end loop;
  update public.questions
  set label = jsonb_build_object('fr', btrim(p_label_fr), 'en', btrim(p_label_en)), is_active = coalesce(p_active, true)
  where id = q.id;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Tableau de santé d'un quartier (SPEC §15), over a period of days (Paris), seeds left out
------------------------------------------------------------------------------------------------
create function public.admin_zone_health(p_zone smallint, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz;
  until timestamptz;
  days integer;
  result jsonb;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if not exists (select 1 from public.launch_zones where id = p_zone) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  since := p_from::timestamp at time zone 'Europe/Paris';
  until := (p_to + 1)::timestamp at time zone 'Europe/Paris';
  days := p_to - p_from + 1;

  with members as (
    select p.* from public.profiles p where p.zone_id = p_zone and not p.is_seed
  ), requests as (
    select r.*, exists (select 1 from public.visit_slots s where s.request_id = r.id) as accepted
    from public.visit_requests r join members v on v.id = r.visitor_id
    where r.created_at >= since and r.created_at < until
  ), decided as (
    select * from requests where accepted or close_reason = 'dismissed_by_bad'
  ), started as (
    select x.* from public.visits x join members v on v.id = x.visitor_id
    where x.starts_at >= since and x.starts_at < until and x.status in ('ended', 'no_show')
  ), dates as (
    select d.* from public.date_proposals d
    join public.conversations c on c.id = d.conversation_id
    join members v on v.id = c.visitor_id
    where d.created_at >= since and d.created_at < until
  ), served as (
    select pp.visitor_id, pp.promenade_date, count(*) as picks
    from public.promenade_picks pp join members v on v.id = pp.visitor_id
    where pp.promenade_date between p_from and p_to
    group by pp.visitor_id, pp.promenade_date
  ), cohort as (
    select m.id, m.role, m.created_at from members m
    where m.onboarding_completed_at is not null and m.created_at >= since and m.created_at < until
  ), zone_reports as (
    select r.* from public.reports r join members t on t.id = r.target_user_id
    where r.created_at >= since and r.created_at < until
  ), zone_photos as (
    select ph.* from public.photos ph join members o on o.id = ph.owner_id
    where ph.reviewed_at >= since and ph.reviewed_at < until
  ), pushes as (
    select o.status from public.push_outbox o join members m on m.id = o.user_id
    where o.created_at >= since and o.created_at < until and o.status in ('sent', 'failed')
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'days', days),
    'gauge', private.zone_gauge(p_zone),
    'members', jsonb_build_object(
      'signed_up', (select count(*) from members m where m.created_at >= since and m.created_at < until),
      'by_role_gender', coalesce((select jsonb_object_agg(k, n) from (
          select coalesce(m.role::text, 'none') || ':' || coalesce(m.gender::text, 'none') as k, count(*) as n
          from members m group by 1) g), '{}'),
      'complete', (select jsonb_build_object(
          'dossiers', count(*) filter (where m.role = 'bad' and m.onboarding_completed_at is not null),
          'permits', count(*) filter (where m.role = 'visitor' and m.onboarding_completed_at is not null))
        from members m)),
    'requests', (select jsonb_build_object(
        'sent', count(*),
        'per_day', round(count(*)::numeric / days, 1),
        'auto_closed', count(*) filter (where status = 'auto_dismissed'),
        'decided', (select count(*) from decided),
        'accepted', (select count(*) from decided where accepted),
        'accepted_right_bet', (select count(*) from decided where accepted and guess_correct),
        'decided_right_bet', (select count(*) from decided where guess_correct),
        'accepted_wrong_bet', (select count(*) from decided where accepted and not guess_correct),
        'decided_wrong_bet', (select count(*) from decided where not guess_correct),
        'avg_response_hours', (select round((avg(extract(epoch from decided_at - created_at)) / 3600)::numeric, 1)
                               from decided where decided_at is not null),
        'with_visit', (select count(*) from requests r where r.accepted
                       and exists (select 1 from public.visits x where x.request_id = r.id)),
        'slots_declined', (select count(*) from requests r where r.accepted and r.slots_declined))
      from requests),
    'visits', (select jsonb_build_object(
        'started', count(*),
        'bad_present', count(*) filter (where bad_joined_at is not null),
        'visitor_present', count(*) filter (where visitor_joined_at is not null),
        'both_present', count(*) filter (where bad_joined_at is not null and visitor_joined_at is not null),
        'released', count(*) filter (where outcome = 'released'),
        'late_cancellations', (select count(*) from public.visits x join members v on v.id = x.visitor_id
                               where x.starts_at >= since and x.starts_at < until and x.cancelled_late))
      from started),
    'cavales', (select jsonb_build_object(
        'proposed', count(*),
        'accepted', count(*) filter (where status = 'accepted' or (status = 'cancelled' and responded_at is not null)))
      from dates),
    'promenade', (select jsonb_build_object(
        'visitor_days', count(*),
        'under_five', count(*) filter (where picks < 5))
      from served),
    'retention', (select jsonb_object_agg(role, jsonb_build_object(
        'cohort_d7', d7_cohort, 'back_d7', d7_back, 'cohort_d30', d30_cohort, 'back_d30', d30_back))
      from (
        select coalesce(c.role::text, 'none') as role,
          count(*) filter (where c.created_at <= now() - interval '7 days') as d7_cohort,
          count(*) filter (where c.created_at <= now() - interval '7 days' and exists (
            select 1 from public.activity_days a where a.user_id = c.id
              and a.day >= ((c.created_at + interval '7 days') at time zone 'Europe/Paris')::date)) as d7_back,
          count(*) filter (where c.created_at <= now() - interval '30 days') as d30_cohort,
          count(*) filter (where c.created_at <= now() - interval '30 days' and exists (
            select 1 from public.activity_days a where a.user_id = c.id
              and a.day >= ((c.created_at + interval '30 days') at time zone 'Europe/Paris')::date)) as d30_back
        from cohort c group by 1) r),
    'moderation', jsonb_build_object(
      'reports', (select count(*) from zone_reports),
      'avg_report_hours', (select round((avg(extract(epoch from decided_at - created_at)) / 3600)::numeric, 1)
                           from zone_reports where decided_at is not null),
      'photos_reviewed', (select count(*) from zone_photos),
      'avg_greffe_hours', (select round((avg(extract(epoch from reviewed_at - created_at)) / 3600)::numeric, 1)
                           from zone_photos)),
    'push', jsonb_build_object(
      'members', (select count(*) from members m where m.onboarding_completed_at is not null),
      'subscribed', (select count(*) from members m where m.onboarding_completed_at is not null
                     and exists (select 1 from public.push_subscriptions s where s.user_id = m.id and s.revoked_at is null)),
      'sent', (select count(*) from pushes where status = 'sent'),
      'failed', (select count(*) from pushes where status = 'failed'))
  ) into result;
  return result;
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. Rights
------------------------------------------------------------------------------------------------
revoke execute on function public.admin_zones(),
  public.admin_save_zone(text, text, bigint, smallint, text, integer, smallint, smallint, boolean, smallint),
  public.admin_set_zone_status(smallint, public.zone_status), public.admin_launch_mode(),
  public.admin_set_launch_mode(public.launch_mode),
  public.admin_tribes(), public.admin_save_tribe(text, text, text, smallint, boolean, smallint),
  public.admin_keywords(), public.admin_save_keyword(text, text, public.report_category, boolean, integer),
  public.admin_questions(), public.admin_save_question(smallint, text, text, boolean, jsonb),
  public.admin_zone_health(smallint, date, date)
  from public, anon;
grant execute on function public.admin_zones(),
  public.admin_save_zone(text, text, bigint, smallint, text, integer, smallint, smallint, boolean, smallint),
  public.admin_set_zone_status(smallint, public.zone_status), public.admin_launch_mode(),
  public.admin_set_launch_mode(public.launch_mode),
  public.admin_tribes(), public.admin_save_tribe(text, text, text, smallint, boolean, smallint),
  public.admin_keywords(), public.admin_save_keyword(text, text, public.report_category, boolean, integer),
  public.admin_questions(), public.admin_save_question(smallint, text, text, boolean, jsonb),
  public.admin_zone_health(smallint, date, date)
  to authenticated;
$mig$]);

commit;

-- Empreintes (sans les blancs) : colonne attendu = colonne base.
select m.version, m.name, x.expected as attendu, md5(regexp_replace(array_to_string(m.statements, ';'), '\s', '', 'g')) as base
from supabase_migrations.schema_migrations m
join (values
  ('20261019130100', '3326cdf7f8de1c410ad280120f3e902c'),
  ('20261020090000', 'cbc779f0d94569fea865100e577d5017')
) as x (version, expected) on x.version = m.version
order by m.version;
