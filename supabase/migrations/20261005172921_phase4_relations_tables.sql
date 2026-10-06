-- Phase 4a (SPEC v7.4 §2 bis, §5, §5 bis, §7, §12, §12 bis, §14; SCHEMA §2.3, §3; PARCOURS-DESIGN §2):
-- the Demande de parloir, the Promenade, the Découverte, the Fiche and the Permis seen by others,
-- the Courrier, blocks, reports, role change and the random N° d'écrou.
-- Rule 14: the chosen charge, the Casier copy and the result of the bet are never returned by any
-- function before the visit (Phase 5 reveals them as the first message of the Parloir).

------------------------------------------------------------------------------------------------
-- 1. Types
------------------------------------------------------------------------------------------------
create type public.visit_request_status as enum (
  'pending', 'accepted', 'released', 'dismissed', 'auto_dismissed', 'cancelled', 'closed'
);
create type public.case_close_reason as enum (
  'dismissed_by_bad', 'no_answer_7d', 'no_slot_chosen', 'no_new_slots', 'second_no_show',
  'not_prolonged', 'no_end_choice', 'closed_after_release', 'cancelled_by_visitor', 'role_change',
  'blocked', 'account_deleted', 'banned'
);
create type public.report_target as enum ('profile', 'permit', 'photo', 'casier', 'message', 'visit_request');
create type public.moderation_action_type as enum (
  'warn', 'suspend', 'ban', 'unban', 'hide_profile', 'unhide_profile', 'photo_approve',
  'photo_reject', 'text_clear', 'text_remove', 'revoke_good_conduct'
);

------------------------------------------------------------------------------------------------
-- 2. N° d'écrou (PARCOURS-DESIGN §2): 6 random digits, unique, Bads only, never derived from the
--    internal id. No function takes it as an input: it cannot be used to find an account.
------------------------------------------------------------------------------------------------
alter table public.profiles add column ecrou char(6) check (ecrou ~ '^[0-9]{6}$');
create unique index profiles_ecrou on public.profiles (ecrou) where ecrou is not null;

create function public.new_ecrou()
returns char(6) language plpgsql volatile security definer set search_path = '' as $$
declare candidate char(6);
begin
  loop
    candidate := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.profiles where ecrou = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.profiles_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.birthdate is not null then
    if public.age_years(new.birthdate) < 18 then
      raise exception 'underage' using errcode = '23514', hint = 'birthdate';
    end if;
    if public.age_years(new.birthdate) > 110 then
      raise exception 'invalid_birthdate' using errcode = '23514', hint = 'birthdate';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.onboarding_completed_at is not null and new.birthdate is distinct from old.birthdate then
      raise exception 'birthdate_locked' using errcode = '42501', hint = 'birthdate';
    end if;
    if new.is_paused and not old.is_paused then new.paused_at := now(); end if;
    if not new.is_paused then new.paused_at := null; end if;
    -- The N° d'écrou is never chosen nor changed: only this trigger gives it, once.
    new.ecrou := old.ecrou;
  else
    new.ecrou := null;
  end if;

  -- A Bad gets a N° d'écrou (kept if the role changes later; shown only on a Bad's Fiche).
  if new.role = 'bad' and new.ecrou is null then new.ecrou := public.new_ecrou(); end if;

  if new.pseudo is not null and public.has_contacts(new.pseudo::text) then
    raise exception 'pseudo_contains_contacts' using errcode = '23514', hint = 'pseudo';
  end if;

  if new.bio is not null then
    new.bio := public.mask_contacts(new.bio);
  end if;
  if new.visit_motive is not null then
    new.visit_motive := public.mask_contacts(new.visit_motive);
  end if;

  if tg_op = 'INSERT' or new.place_id is distinct from old.place_id then
    select pl.lat, pl.lng into new.lat, new.lng from public.places pl where pl.id = new.place_id;
    new.zone_id := public.zone_for(new.lat, new.lng);
  end if;

  new.requests_open := not new.requests_closed_manual and new.pending_requests_count < new.requests_cap;
  new.updated_at := now();
  return new;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. Blocks, reports, moderation actions (minimal; the admin screens come in Phase 7)
------------------------------------------------------------------------------------------------
-- A block is never deleted: unblocking sets unblocked_at (history kept, rows are never removed).
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unblocked_at timestamptz,
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked on public.blocks (blocked_id) where unblocked_at is null;

create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid references public.profiles (id) on delete set null,
  target_user_id uuid references public.profiles (id) on delete cascade,
  target_type public.report_target not null,
  target_id text not null,
  category public.report_category not null,
  comment varchar(500),
  status public.report_status not null default 'open',
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index reports_queue on public.reports (status, created_at);
create index reports_target_user on public.reports (target_user_id, status);
create index reports_reporter on public.reports (reporter_id, created_at desc);

create table public.moderation_actions (
  id bigint generated always as identity primary key,
  target_user_id uuid references public.profiles (id) on delete cascade,
  action public.moderation_action_type not null,
  reason text,
  report_id bigint references public.reports (id) on delete set null,
  admin_id uuid,
  created_at timestamptz not null default now()
);
create index moderation_actions_target on public.moderation_actions (target_user_id, created_at desc);
create trigger moderation_actions_append_only
  before update or delete on public.moderation_actions
  for each row execute function public.append_only();

------------------------------------------------------------------------------------------------
-- 4. La Demande de parloir (SCHEMA §2.3)
------------------------------------------------------------------------------------------------
create table public.visit_requests (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null references public.profiles (id) on delete cascade,
  bad_id uuid not null references public.profiles (id) on delete cascade,
  guessed_index smallint not null check (guessed_index between 1 and 3),
  -- Copy of the Casier when the request is sent (SPEC §6): the bet stays right even if it changes.
  casier_snapshot jsonb not null,
  guess_correct boolean not null,
  note varchar(280),
  note_normalized text,
  status public.visit_request_status not null default 'pending',
  close_reason public.case_close_reason,
  slots_round smallint not null default 0,
  slots_declined boolean not null default false,
  choose_deadline timestamptz,
  repropose_deadline timestamptz,
  no_show_count smallint not null default 0,
  conversation_id uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  closed_at timestamptz,
  check (visitor_id <> bad_id)
);
create unique index visit_requests_one_open on public.visit_requests (visitor_id, bad_id)
  where status in ('pending', 'accepted');
create index visit_requests_mailbox on public.visit_requests (bad_id, status, created_at);
create index visit_requests_visitor on public.visit_requests (visitor_id, created_at desc);
create index visit_requests_pending on public.visit_requests (status, created_at) where status = 'pending';
create index visit_requests_pair_closed on public.visit_requests (visitor_id, bad_id, closed_at desc);

-- Keeps the Bad's pending count (→ requests_open, « Parloir complet ») and the Visitor's
-- consecutive dismissals (advice after 3, SPEC §7) in step with the requests.
create function public.visit_requests_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
  set pending_requests_count = (select count(*) from public.visit_requests r
                                where r.bad_id = new.bad_id and r.status = 'pending')
  where id = new.bad_id;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'dismissed' then
      update public.profiles set consecutive_dismissals = consecutive_dismissals + 1 where id = new.visitor_id;
    elsif new.status = 'accepted' then
      update public.profiles set consecutive_dismissals = 0 where id = new.visitor_id;
    end if;
  end if;
  return null;
end;
$$;
create trigger visit_requests_after_write
  after insert or update on public.visit_requests
  for each row execute function public.visit_requests_after_write();

------------------------------------------------------------------------------------------------
-- 5. La Promenade (SPEC §12, SCHEMA promenade_picks)
------------------------------------------------------------------------------------------------
create table public.promenade_picks (
  id bigint generated always as identity primary key,
  visitor_id uuid not null references public.profiles (id) on delete cascade,
  bad_id uuid not null references public.profiles (id) on delete cascade,
  zone_id smallint references public.launch_zones (id) on delete set null,
  promenade_date date not null,
  rank smallint not null check (rank between 1 and 5),
  score smallint not null,
  visible_from timestamptz not null,
  visible_until timestamptz not null,
  seen_at timestamptz,
  unique (visitor_id, promenade_date, bad_id),
  unique (visitor_id, promenade_date, rank)
);
create index promenade_picks_visitor on public.promenade_picks (visitor_id, visible_from desc);
create index promenade_picks_bad on public.promenade_picks (bad_id, promenade_date);

------------------------------------------------------------------------------------------------
-- 6. Internal helpers (no execute right for members)
------------------------------------------------------------------------------------------------
create function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks
                 where unblocked_at is null
                   and ((blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a)))
$$;

create function public.is_member_active(p public.profiles)
returns boolean language sql stable set search_path = '' as $$
  select p.onboarding_completed_at is not null and p.banned_at is null and p.hidden_reason is null
    and (p.suspended_until is null or p.suspended_until <= now())
$$;

create function public.zone_is_open(p_zone smallint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_settings s where s.launch_mode = 'open')
    or exists (select 1 from public.launch_zones z where z.id = p_zone and z.status = 'open')
$$;

-- A Visitor whose face photo is validated: the Permis de visite is delivered (SPEC §5 bis).
create function public.has_permit(p_visitor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id = p_visitor and p.role = 'visitor' and public.is_member_active(p)
                   and exists (select 1 from public.photos ph where ph.owner_id = p.id
                               and ph.position = 0 and ph.status = 'approved'))
$$;

-- A Bad seen by Visitors (SCHEMA §3.1): active, 3 poses validated, Casier, not paused,
-- seen within 90 days, open zone.
create function public.is_bad_visible(p public.profiles)
returns boolean language sql stable security definer set search_path = '' as $$
  select p.role = 'bad' and public.is_member_active(p) and not p.is_paused
    and p.last_seen_at >= now() - interval '90 days'
    and public.has_three_poses(p.id, true)
    and exists (select 1 from public.casier_charges c where c.profile_id = p.id)
    and public.zone_is_open(p.zone_id)
$$;

-- Gender and age criteria, in both directions (SPEC §7).
create function public.criteria_match(p_a public.profiles, p_b public.profiles)
returns boolean language sql stable set search_path = '' as $$
  select p_a.gender = any (p_b.seeking_genders) and p_b.gender = any (p_a.seeking_genders)
    and public.age_years(p_a.birthdate) between p_b.seek_age_min and p_b.seek_age_max
    and public.age_years(p_b.birthdate) between p_a.seek_age_min and p_a.seek_age_max
$$;

create function public.can_view_bad(p_viewer uuid, p_bad uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles v, public.profiles b
    where v.id = p_viewer and b.id = p_bad
      and v.role = 'visitor' and public.is_member_active(v) and public.zone_is_open(v.zone_id)
      and public.is_bad_visible(b) and public.criteria_match(v, b)
      and not public.is_blocked_between(v.id, b.id))
$$;

-- A request in progress or a Permis permanent between them (SCHEMA §3.1, B2).
create function public.has_open_relation(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.visit_requests r
                 where r.status in ('pending', 'accepted', 'released')
                   and ((r.visitor_id = p_a and r.bad_id = p_b) or (r.visitor_id = p_b and r.bad_id = p_a)))
$$;

-- 30 days after a case is closed (refusal, no answer, visit without Permis permanent…).
create function public.pair_cooldown_until(p_visitor uuid, p_bad uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select max(r.closed_at) + interval '30 days' from public.visit_requests r
  where r.visitor_id = p_visitor and r.bad_id = p_bad
    and r.status in ('dismissed', 'auto_dismissed', 'closed')
$$;

-- « Casier vierge » (no upheld report, no warning or suspension within 12 months) and
-- « Visites honorées X/Y » (visits arrive in Phase 5: 0/0 until then = « Nouveau visiteur »).
create function public.visitor_reputation(p_visitor uuid)
returns table (clean_record boolean, honored integer, due integer)
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.reports r where r.target_user_id = p_visitor and r.status = 'upheld'
                       and r.created_at > now() - interval '12 months')
     and not exists (select 1 from public.moderation_actions m where m.target_user_id = p_visitor
                       and m.action in ('warn', 'suspend', 'ban') and m.created_at > now() - interval '12 months'),
    0, 0
$$;

-- Exact integer rounding of the complicity score (SPEC §9), shared by complicity_score and the
-- set-based queries (Découverte, Promenade). Mirror: lib/complicity.ts.
create function public.complicity_from_sums(n_a bigint, d_a bigint, n_b bigint, d_b bigint, cnt integer, cap boolean)
returns smallint language plpgsql immutable set search_path = '' as $$
declare p bigint; q bigint; s bigint;
begin
  if cnt is null or cnt < 5 or d_a = 0 or d_b = 0 then return null; end if;
  p := 40000 * n_a * n_b;
  q := d_a * d_b;
  s := round(100 * sqrt((n_a * n_b)::double precision / q))::bigint;
  while s > 0 and (2 * s - 1) * (2 * s - 1) * q > p loop s := s - 1; end loop;
  while (2 * s + 1) * (2 * s + 1) * q <= p loop s := s + 1; end loop;
  if cap then s := least(s, 50); end if;
  return s::smallint;
end;
$$;

-- Complicity of one viewer with many members at once (one aggregate, no per-pair call).
create function public.complicity_with(p_viewer uuid, p_others uuid[])
returns table (other_id uuid, score smallint)
language sql stable security definer set search_path = '' as $$
  select o.user_id,
    public.complicity_from_sums(
      sum(public.importance_weight(v.importance)) filter (where v.accepted_option_ids is null or o.option_id = any (v.accepted_option_ids)),
      sum(public.importance_weight(v.importance)),
      sum(public.importance_weight(o.importance)) filter (where o.accepted_option_ids is null or v.option_id = any (o.accepted_option_ids)),
      sum(public.importance_weight(o.importance)),
      count(*)::integer,
      coalesce(bool_or(
        (v.importance = 'essential' and not (v.accepted_option_ids is null or o.option_id = any (v.accepted_option_ids)))
        or (o.importance = 'essential' and not (o.accepted_option_ids is null or v.option_id = any (o.accepted_option_ids)))), false))
  from public.answers v
  join public.answers o on o.question_id = v.question_id and o.user_id = any (p_others) and o.user_id <> p_viewer
  join public.questions qu on qu.id = v.question_id and qu.is_active
  where v.user_id = p_viewer
  group by o.user_id
$$;

-- complicity_score keeps its contract (parity cases) and now uses the shared rounding.
create or replace function public.complicity_score(p_a uuid, p_b uuid)
returns table (score smallint, common_count integer, capped boolean)
language sql stable security definer set search_path = '' as $$
  select public.complicity_from_sums(n_a, d_a, n_b, d_b, cnt, cap), cnt, case when cnt >= 5 then cap else false end
  from (
    select count(*)::integer cnt,
      coalesce(sum(public.importance_weight(a.importance))
        filter (where a.accepted_option_ids is null or b.option_id = any (a.accepted_option_ids)), 0) n_a,
      coalesce(sum(public.importance_weight(a.importance)), 0) d_a,
      coalesce(sum(public.importance_weight(b.importance))
        filter (where b.accepted_option_ids is null or a.option_id = any (b.accepted_option_ids)), 0) n_b,
      coalesce(sum(public.importance_weight(b.importance)), 0) d_b,
      coalesce(bool_or(
        (a.importance = 'essential' and not (a.accepted_option_ids is null or b.option_id = any (a.accepted_option_ids)))
        or (b.importance = 'essential' and not (b.accepted_option_ids is null or a.option_id = any (b.accepted_option_ids)))), false) cap
    from public.answers a
    join public.answers b on b.question_id = a.question_id and b.user_id = p_b
    join public.questions qu on qu.id = a.question_id and qu.is_active
    where a.user_id = p_a and p_a <> p_b
  ) t
$$;

create function public.distance_km(p_a public.profiles, p_b public.profiles)
returns integer language sql stable set search_path = '' as $$
  select case when p_a.lat is null or p_b.lat is null then null
    else round(extensions.earth_distance(extensions.ll_to_earth(p_a.lat, p_a.lng),
                                         extensions.ll_to_earth(p_b.lat, p_b.lng)) / 1000)::integer end
$$;

-- Public side of a member (never the birth date, the id of a photo file only once validated).
create function public.public_photos(p_owner uuid, p_positions smallint[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('position', ph.position, 'large', ph.public_path_large,
                                               'small', ph.public_path_small) order by ph.position), '[]')
  from public.photos ph
  where ph.owner_id = p_owner and ph.status = 'approved' and ph.position = any (p_positions)
$$;

create function public.public_tribes(p_owner uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', t.label, 'detail', pt.detail) order by t.sort), '[]')
  from public.profile_tribes pt join public.tribes t on t.id = pt.tribe_id
  where pt.profile_id = p_owner
$$;

create function public.place_name(p_place bigint)
returns text language sql stable security definer set search_path = '' as $$
  select name from public.places where id = p_place
$$;

-- In-app notification (SCHEMA §2.4). Web Push arrives in Phase 5a.
create function public.notify(p_user uuid, p_type public.notification_type, p_payload jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, payload) values (p_user, p_type, p_payload)
$$;

------------------------------------------------------------------------------------------------
-- 7. Row Level Security; helpers are internal
------------------------------------------------------------------------------------------------
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.visit_requests enable row level security;
alter table public.promenade_picks enable row level security;
revoke all on public.blocks, public.reports, public.moderation_actions, public.visit_requests,
  public.promenade_picks from anon, authenticated;
-- A member sees the list of people they blocked (to unblock them); nothing else is readable.
grant select on public.blocks to authenticated;
create policy "own blocks readable" on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
-- visit_requests, promenade_picks, reports, moderation_actions: no policy, no grant.

-- The helpers: no execute right for members (they run inside the definer functions only).
revoke execute on function
  public.new_ecrou(),
  public.visit_requests_after_write(),
  public.is_blocked_between(uuid, uuid),
  public.is_member_active(public.profiles),
  public.zone_is_open(smallint),
  public.has_permit(uuid),
  public.is_bad_visible(public.profiles),
  public.criteria_match(public.profiles, public.profiles),
  public.can_view_bad(uuid, uuid),
  public.has_open_relation(uuid, uuid),
  public.pair_cooldown_until(uuid, uuid),
  public.visitor_reputation(uuid),
  public.complicity_from_sums(bigint, bigint, bigint, bigint, integer, boolean),
  public.complicity_with(uuid, uuid[]),
  public.distance_km(public.profiles, public.profiles),
  public.public_photos(uuid, smallint[]),
  public.public_tribes(uuid),
  public.place_name(bigint),
  public.notify(uuid, public.notification_type, jsonb)
  from public, anon, authenticated;

