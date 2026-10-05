-- Phase 3 (security review corrections + docs/PARCOURS-DESIGN.md §3):
--   distinct Casier charges, the Bad's 3-pose photo (0 face, 1 left profile, 2 right profile),
--   in-app notifications and the minimal Greffe (each photo validated separately).

------------------------------------------------------------------------------------------------
-- 1. The Casier: three different charges (case and spaces ignored)
------------------------------------------------------------------------------------------------
-- Comparison key of a charge: lower case, without any whitespace. Mirror: lib/casier.ts.
create function public.charge_key(value text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select lower(regexp_replace(coalesce(value, ''), '\s+', '', 'g'))
$$;

create or replace function public.casier_charges_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select role from public.profiles where id = new.profile_id) is distinct from 'bad' then
    raise exception 'casier_bad_only' using errcode = '42501';
  end if;
  -- The mask token can be longer than what it replaces: keep within 120 characters.
  new.charge_1 := left(btrim(public.mask_contacts(new.charge_1)), 120);
  new.charge_2 := left(btrim(public.mask_contacts(new.charge_2)), 120);
  new.charge_3 := left(btrim(public.mask_contacts(new.charge_3)), 120);
  if public.charge_key(new.charge_1) = public.charge_key(new.charge_2)
     or public.charge_key(new.charge_1) = public.charge_key(new.charge_3)
     or public.charge_key(new.charge_2) = public.charge_key(new.charge_3) then
    raise exception 'casier_duplicate_charges' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. The Bad's 3 poses (PARCOURS-DESIGN §3)
------------------------------------------------------------------------------------------------
-- Positions that a Bad must have: 0 face (identity photo), 1 left profile, 2 right profile.
create function public.has_three_poses(p_owner uuid, p_approved_only boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select count(distinct position) = 3 from public.photos
  where owner_id = p_owner and position in (0, 1, 2) and (not p_approved_only or status = 'approved')
$$;

create or replace function public.complete_onboarding()
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  missing text[] := '{}';
begin
  select * into me from public.profiles where id = (select auth.uid()) for update;
  if not found then raise exception 'no_profile' using errcode = 'P0002'; end if;
  if me.onboarding_completed_at is not null then return; end if;
  if me.birthdate is null then missing := missing || 'birthdate'::text; end if;
  if me.pseudo is null or me.gender is null or me.place_id is null then missing := missing || 'identity'::text; end if;
  if me.role is null then missing := missing || 'role'::text; end if;
  if cardinality(me.seeking_genders) = 0 then missing := missing || 'seeking'::text; end if;
  if exists (
    select 1 from unnest(array['terms', 'privacy', 'age_18', 'art9_seeking']::public.consent_type[]) t
    where not coalesce((select c.granted from public.consents c
                        where c.user_id = me.id and c.type = t
                        order by c.created_at desc limit 1), false)
  ) then missing := missing || 'consents'::text; end if;
  -- A Visitor: the face photo only. A Bad: the 3 poses.
  if me.role = 'bad' then
    if not public.has_three_poses(me.id) then missing := missing || 'photos'::text; end if;
  elsif not exists (select 1 from public.photos where owner_id = me.id and position = 0) then
    missing := missing || 'photo'::text;
  end if;
  if me.role = 'bad' and not exists (select 1 from public.casier_charges where profile_id = me.id) then
    missing := missing || 'casier'::text;
  end if;
  if me.role = 'visitor' and me.visit_motive is null then missing := missing || 'visit_motive'::text; end if;
  if exists (
    select 1 from public.questions qu
    where qu.is_active and qu.phase = 'core'
      and not exists (select 1 from public.answers an where an.user_id = me.id and an.question_id = qu.id)
  ) then missing := missing || 'core_answers'::text; end if;
  if cardinality(missing) > 0 then
    raise exception 'onboarding_incomplete' using errcode = '23514', detail = array_to_string(missing, ',');
  end if;
  update public.profiles set onboarding_completed_at = now(), onboarding_step = 8 where id = me.id;
end;
$$;

-- A Bad counts for the zone only once the 3 poses are validated by the Greffe.
create or replace function public.counts_for_zone(p public.profiles)
returns boolean language sql stable security definer set search_path = '' as $$
  select p.role = 'bad' and p.onboarding_completed_at is not null
    and p.banned_at is null and p.hidden_reason is null
    and (p.suspended_until is null or p.suspended_until <= now())
    and not p.is_paused and not p.is_seed
    and p.last_seen_at >= now() - make_interval(days => (select s.zone_bad_active_days from public.app_settings s))
    and public.has_three_poses(p.id, true)
$$;

------------------------------------------------------------------------------------------------
-- 3. In-app notifications (SCHEMA §2.4). Written only by SQL functions.
------------------------------------------------------------------------------------------------
create type public.notification_type as enum (
  'request_received', 'request_accepted', 'request_dismissed', 'slot_chosen', 'slots_declined',
  'slots_reproposed', 'visit_cancelled', 'visit_reminder_1h', 'visit_starting', 'visit_no_show',
  'visit_released', 'visit_closed', 'message_received', 'date_proposed', 'date_accepted',
  'date_countered', 'promenade_open', 'permit_granted', 'moderation_decision', 'zone_opened',
  'profile_dormant'
);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.notification_type not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on public.notifications (user_id, created_at desc);
create index notifications_unread on public.notifications (user_id) where read_at is null;

create function public.mark_notifications_read()
returns void language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
  where user_id = (select auth.uid()) and read_at is null
$$;

------------------------------------------------------------------------------------------------
-- 4. The Greffe, minimum (SPEC §11, PARCOURS-DESIGN §3): each photo is decided separately.
--    Files are moved by the server (secret key); these functions only record the decision.
------------------------------------------------------------------------------------------------
-- Rejection reasons shown to the member (translated in the UI).
create function public.photo_rejection_reasons()
returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array['face_hidden', 'not_alone', 'sunglasses', 'nudity', 'contacts', 'wrong_pose', 'not_adult', 'other']
$$;

-- Queue, by priority: Visitors' face photo in an open zone, then the Bads' 3 poses, then the rest.
create function public.admin_photo_queue(p_limit integer default 50)
returns table (
  photo_id uuid, owner_id uuid, pseudo text, role public.member_role, gender public.gender,
  photo_position smallint, pending_path text, created_at timestamptz, priority integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select ph.id, ph.owner_id, pr.pseudo::text, pr.role, pr.gender, ph.position, ph.pending_path, ph.created_at,
      case
        when pr.role = 'visitor' and ph.position = 0
          and (exists (select 1 from public.app_settings s where s.launch_mode = 'open')
               or exists (select 1 from public.launch_zones z where z.id = pr.zone_id and z.status = 'open')) then 0
        when pr.role = 'bad' and ph.position in (0, 1, 2) then 1
        else 2
      end
    from public.photos ph
    join public.profiles pr on pr.id = ph.owner_id
    where ph.status = 'pending' and ph.pending_path is not null and pr.banned_at is null
    order by 9, ph.created_at
    limit greatest(least(p_limit, 200), 1);
end;
$$;

-- Records the decision on one photo and notifies its owner. Returns the pending path to delete.
-- Approval needs the two public file names (random UUID, never the owner id).
create function public.admin_decide_photo(p_photo uuid, p_approve boolean, p_reason text default null,
  p_public_large text default null, p_public_small text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  ph public.photos;
  owner_role public.member_role;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into ph from public.photos where id = p_photo for update;
  if not found or ph.status <> 'pending' then
    raise exception 'photo_not_pending' using errcode = '23514';
  end if;
  if p_approve then
    if p_public_large is null or p_public_small is null
       or p_public_large !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
       or p_public_small !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-s\.webp$' then
      raise exception 'invalid_public_path' using errcode = '22023';
    end if;
    update public.photos set status = 'approved', public_path_large = p_public_large,
      public_path_small = p_public_small, pending_path = null, rejection_reason = null,
      reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_photo;
  else
    if p_reason is null or not (p_reason = any (public.photo_rejection_reasons())) then
      raise exception 'invalid_reason' using errcode = '22023';
    end if;
    update public.photos set status = 'rejected', pending_path = null, rejection_reason = p_reason,
      reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_photo;
  end if;

  insert into public.notifications (user_id, type, payload)
  values (ph.owner_id, 'moderation_decision', jsonb_build_object(
    'photo_position', ph.position, 'approved', p_approve, 'reason', case when p_approve then null else p_reason end));
  -- The Visitor's face photo delivers the Permis de visite (stamp « PERMIS DÉLIVRÉ »).
  select role into owner_role from public.profiles where id = ph.owner_id;
  if p_approve and ph.position = 0 and owner_role = 'visitor' then
    insert into public.notifications (user_id, type, payload) values (ph.owner_id, 'permit_granted', '{}');
  end if;
  return ph.pending_path;
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. English labels corrected after review (docs/content/questions-en.md)
------------------------------------------------------------------------------------------------
update public.question_options set label = jsonb_set(label, '{en}', '"Night-out partners"') where id = 14;
update public.questions set label = jsonb_set(label, '{en}', '"What you get told off for most…"') where id = 15;

------------------------------------------------------------------------------------------------
-- 6. Row Level Security and grants
------------------------------------------------------------------------------------------------
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
create policy "own notifications readable" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

revoke execute on function public.charge_key(text), public.has_three_poses(uuid, boolean),
  public.mark_notifications_read(), public.photo_rejection_reasons(),
  public.admin_photo_queue(integer), public.admin_decide_photo(uuid, boolean, text, text, text)
  from public, anon, authenticated;
-- Members mark their own notifications; the Greffe functions check is_admin() first.
grant execute on function public.mark_notifications_read() to authenticated;
grant execute on function public.admin_photo_queue(integer) to authenticated;
grant execute on function public.admin_decide_photo(uuid, boolean, text, text, text) to authenticated;
