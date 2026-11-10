-- 10d (owner's feedback 2026-11-10, real members in production): what an admin could not see
-- without the database. For an admin with the second factor (is_admin()), read only except the
-- log of the opened member records:
--  - admin_list_members(...): every account, in pages, no search needed; filters role, state,
--    dossier finished or not, dossier blocked (photos validated, dossier unfinished);
--  - admin_member_detail(user): the full record of a member (identity, criteria, texts, Casier
--    WITHOUT the true charge (règle 14), answers, photos and their status, consents, last visit,
--    what the dossier lacks, visible in the Découverte or why not); each opening is logged in
--    greffe_fiche_views (context « member »);
--  - admin_dashboard(): the same figures, plus the Bads with their 3 poses validated and the
--    blocked dossiers;
--  - admin_unconfirmed_accounts(): the accounts never confirmed after 48 hours, by date and domain
--    of the address only (never the address itself), to spot a mistyped address.

------------------------------------------------------------------------------------------------
-- 1. The log of the opened records: the Vue Greffe (10a) and now the Membres record
------------------------------------------------------------------------------------------------
alter table public.greffe_fiche_views
  add column context text not null default 'vue' check (context in ('vue', 'member'));
comment on table public.greffe_fiche_views is
  'Which admin opened which Fiche (Vue Greffe, 10a) or which member record (Membres, 10d), when. Written by admin_view_fiche and admin_member_detail only.';

------------------------------------------------------------------------------------------------
-- 2. Why a Bad is not in the Découverte (empty: visible), in the order an admin would fix it.
--    The same conditions as is_bad_visible(), one by one (checked by pgTAP).
------------------------------------------------------------------------------------------------
create function private.discover_hidden_reasons(p public.profiles)
returns text[] language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when p.role is distinct from 'bad' then 'not_bad' end,
    case when p.onboarding_completed_at is null then 'dossier_incomplete' end,
    case when p.banned_at is not null then 'banned' end,
    case when p.hidden_reason is not null then 'hidden' end,
    case when p.suspended_until > now() then 'suspended' end,
    case when p.is_paused then 'paused' end,
    case when not coalesce(p.last_seen_at >= now() - interval '90 days', false) then 'dormant' end,
    case when not public.has_three_poses(p.id, true) then 'poses_not_validated' end,
    case when not exists (select 1 from public.casier_charges c where c.profile_id = p.id) then 'no_casier' end,
    case when not public.zone_is_open(p.zone_id) then 'zone_closed' end
  ], null)
$$;
revoke execute on function private.discover_hidden_reasons(public.profiles) from public, anon, authenticated, service_role;

-- A blocked dossier: the photos are validated (the 3 poses of a Bad, the face of a Visitor) but
-- the dossier is not finished.
create function private.dossier_blocked(p public.profiles)
returns boolean language sql stable security definer set search_path = '' as $$
  select p.onboarding_completed_at is null and case p.role
    when 'bad' then public.has_three_poses(p.id, true)
    when 'visitor' then exists (select 1 from public.photos ph
                                where ph.owner_id = p.id and ph.position = 0 and ph.status = 'approved')
    else false end
$$;
revoke execute on function private.dossier_blocked(public.profiles) from public, anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 3. The list of the members: every confirmed account (with a profile or not yet), newest first,
--    50 a page. Seed profiles and the super admin (no profile) are left out.
------------------------------------------------------------------------------------------------
create function public.admin_list_members(p_role public.member_role default null,
  p_state text default null, p_complete boolean default null, p_blocked boolean default false,
  p_page integer default 1)
returns table (user_id uuid, pseudo text, role public.member_role, state text,
  created_at timestamptz, last_seen_at timestamptz, complete boolean, blocked boolean, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare page integer := greatest(coalesce(p_page, 1), 1);
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    with members as (
      select u.id, p.pseudo::text as pseudo, p.role,
        case when p.id is null then 'not_started' else private.member_state(p) end as state,
        u.created_at, p.last_seen_at,
        p.onboarding_completed_at is not null as complete,
        p.id is not null and private.dossier_blocked(p) as blocked
      from auth.users u
      left join public.profiles p on p.id = u.id
      where u.email_confirmed_at is not null
        and not coalesce(p.is_seed, false)
        and (p.id is not null or not exists (select 1 from public.admin_users a where a.user_id = u.id))
    )
    select m.id, m.pseudo, m.role, m.state, m.created_at, m.last_seen_at, m.complete, m.blocked,
      count(*) over ()
    from members m
    where (p_role is null or m.role = p_role)
      and (p_state is null or m.state = p_state)
      and (p_complete is null or m.complete = p_complete)
      and (not coalesce(p_blocked, false) or m.blocked)
    order by m.created_at desc, m.id desc
    limit 50 offset (page - 1) * 50;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. The full record of a member, read only; the opening is logged.
------------------------------------------------------------------------------------------------
create function public.admin_member_detail(p_user uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  u auth.users;
  p public.profiles;
  has_profile boolean;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into u from auth.users where id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into p from public.profiles where id = p_user;
  has_profile := found;
  if has_profile then
    insert into public.greffe_fiche_views (admin_id, bad_id, context)
    values ((select auth.uid()), p.id, 'member');
  end if;
  return jsonb_build_object(
    'id', u.id,
    'has_profile', has_profile,
    'account_created_at', u.created_at,
    'email_confirmed_at', u.email_confirmed_at,
    'last_sign_in_at', u.last_sign_in_at,
    'last_seen_at', p.last_seen_at,
    'pseudo', p.pseudo,
    'role', p.role,
    'state', case when has_profile then private.member_state(p) else 'not_started' end,
    'gender', p.gender,
    'age', public.age_years(p.birthdate),
    'city', public.place_name(p.place_id),
    'zone', (select z.name from public.launch_zones z where z.id = p.zone_id),
    'seeking_genders', coalesce(to_jsonb(p.seeking_genders), '[]'::jsonb),
    'seek_age_min', p.seek_age_min,
    'seek_age_max', p.seek_age_max,
    'bio', p.bio,
    'visit_motive', p.visit_motive,
    'tribes', coalesce((
      select jsonb_agg(jsonb_build_object('label', t.label, 'detail', pt.detail) order by t.sort)
      from public.profile_tribes pt join public.tribes t on t.id = pt.tribe_id
      where pt.profile_id = p_user), '[]'::jsonb),
    -- Règle 14: the 3 charges as the Visitors read them, never which one is true.
    'casier', (select jsonb_build_array(c.charge_1, c.charge_2, c.charge_3)
               from public.casier_charges c where c.profile_id = p_user),
    'answers', (select count(*) from public.answers a where a.user_id = p_user),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('position', ph.position, 'status', ph.status,
        'rejection_reason', ph.rejection_reason, 'cutout', ph.is_cutout, 'waived', ph.cutout_waived,
        'created_at', ph.created_at, 'reviewed_at', ph.reviewed_at,
        'pending_path', ph.pending_path, 'public_small', ph.public_path_small) order by ph.position)
      from public.photos ph where ph.owner_id = p_user), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('type', c.type, 'granted', c.granted,
        'version', c.text_version, 'created_at', c.created_at) order by c.created_at desc)
      from public.consents c where c.user_id = p_user), '[]'::jsonb),
    'missing', to_jsonb(private.onboarding_missing_for(p_user)),
    'blocked', has_profile and private.dossier_blocked(p),
    'hidden_reasons', case when p.role = 'bad' then to_jsonb(private.discover_hidden_reasons(p)) end
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. The accounts never confirmed after 48 hours: when, and the domain of the address only.
------------------------------------------------------------------------------------------------
create function public.admin_unconfirmed_accounts()
returns table (created_at timestamptz, domain text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select u.created_at, lower(split_part(u.email, '@', 2))
    from auth.users u
    where u.email_confirmed_at is null and u.created_at < now() - interval '48 hours'
      and u.deleted_at is null
    order by u.created_at desc
    limit 200;
end;
$$;

------------------------------------------------------------------------------------------------
-- 6. The dashboard: unambiguous figures, plus the Bads with their 3 poses validated and the
--    blocked dossiers.
------------------------------------------------------------------------------------------------
create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  counts record;
  s public.app_settings;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into counts from public.admin_counts();
  select * into s from public.app_settings where id;
  return jsonb_build_object(
    'bads_registered', (select count(*) from public.profiles p where p.role = 'bad' and not p.is_seed),
    'bads_complete', (select count(*) from public.profiles p
      where p.role = 'bad' and not p.is_seed and p.onboarding_completed_at is not null),
    'bads_three_photos', (select count(*) from public.profiles p
      where p.role = 'bad' and not p.is_seed and public.has_three_poses(p.id, true)),
    'bads_visible', (select count(*) from public.profiles p
      where p.role = 'bad' and not p.is_seed and public.is_bad_visible(p)),
    'visitors_registered', (select count(*) from public.profiles p where p.role = 'visitor' and not p.is_seed),
    'visitors_complete', (select count(*) from public.profiles p
      where p.role = 'visitor' and not p.is_seed and p.onboarding_completed_at is not null),
    'dossiers_blocked', (select count(*) from public.profiles p
      where not p.is_seed and private.dossier_blocked(p)),
    'photos_pending', counts.photos_pending,
    'reports_open', counts.reports_open,
    'flags_open', counts.flags_open,
    'zones_open', (select count(*) from public.launch_zones z where z.status = 'open'),
    'zones_waitlist', (select count(*) from public.launch_zones z where z.status = 'waitlist'),
    'emails_sent_today', (select q.sent from public.email_quota_days q where q.day = private.email_quota_day()),
    'emails_app_quota', case when s.id then s.email_daily_quota - s.email_auth_reserve end,
    'push_queued', (select count(*) from public.push_outbox o where o.status = 'queued'),
    'todo', coalesce((
      select jsonb_agg(jsonb_build_object('kind', t.kind, 'created_at', t.created_at, 'pseudo', t.pseudo,
        'detail', t.detail) order by t.created_at)
      from (
        select * from (
          select 'photo'::text as kind, ph.created_at, pr.pseudo::text as pseudo, ph.position::text as detail
          from public.photos ph join public.profiles pr on pr.id = ph.owner_id
          where ph.status = 'pending' and ph.pending_path is not null and pr.banned_at is null
          union all
          select 'report', r.created_at, t.pseudo::text, r.category::text
          from public.reports r left join public.profiles t on t.id = r.target_user_id
          where r.status = 'open'
          union all
          select 'flag', f.created_at, p.pseudo::text, f.source::text
          from public.flagged_texts f left join public.profiles p on p.id = f.user_id
          where f.status = 'open'
        ) waiting
        order by created_at
        limit 10
      ) t), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_list_members(public.member_role, text, boolean, boolean, integer) from public, anon, authenticated, service_role;
revoke execute on function public.admin_member_detail(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.admin_unconfirmed_accounts() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_members(public.member_role, text, boolean, boolean, integer) to authenticated;
grant execute on function public.admin_member_detail(uuid) to authenticated;
grant execute on function public.admin_unconfirmed_accounts() to authenticated;
