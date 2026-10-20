-- bad-boys-preview (chvnmzmvcjvhxlnfmlvv) seulement. Enregistre seulement l'historique de la migration (déjà appliquée) 20261019130100_phase7a_moderation.sql, texte exact du fichier.
-- MD5 attendu du texte : 52b8eb75a56ef1349c8201794063b7d0

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
$mig$])
returning version, name, md5(array_to_string(statements, ';')) as md5_statements;
