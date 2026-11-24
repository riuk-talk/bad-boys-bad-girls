-- 10i (owner's request 2026-11-24): the full member record in /admin (Membres › fiche).
-- admin_member_extra(user), beside admin_member_detail (10d), for a role holding members.detail:
-- exact date of birth, N° d'écrou, role and the date of its last change; the answers to the
-- Interrogatoire; the activity (requests, visits, Permis permanents, Cavales, blocks, reports,
-- sanctions); the settings (pause, cap, notifications, devices, referrals). The Casier stays the
-- one of admin_member_detail: never which charge is true (règle 14), not even for the super admin.
-- The e-mail: a new permission, members.email (Admin; not Modérateur nor Observateur; the super
-- admin always), shown only on « Afficher l'e-mail », each showing logged (greffe_fiche_views,
-- context « email »). It is in no list and in no partial search.

-- The permission (its verb is a new one for the keys' format).
alter table public.admin_permissions drop constraint admin_permissions_key_check;
alter table public.admin_permissions add constraint admin_permissions_key_check
  check (key ~ '^[a-z_]+\.(view|detail|decide|edit|apply|manage|message|email)$');
insert into public.admin_permissions (key, kind, position) values ('members.email', 'read', 20);
insert into public.admin_role_permissions (role_id, permission)
select r.id, 'members.email' from public.admin_roles r where r.id = 1
on conflict do nothing;

-- Each showing of an e-mail is logged with the other readings of the Greffe.
alter table public.greffe_fiche_views drop constraint greffe_fiche_views_context_check;
alter table public.greffe_fiche_views
  add constraint greffe_fiche_views_context_check
  check (context in ('vue', 'member', 'vue_bad', 'messagerie', 'email'));

---------------------------------------------------------------------------------------------------
-- The rest of the record (read with admin_member_detail, whose opening is already logged).
create function public.admin_member_extra(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  if not public.has_admin_permission('members.detail') then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'birthdate', p.birthdate,
    'ecrou', p.ecrou,
    'role', p.role,
    'role_changed_at', p.role_changed_at,
    -- L'Interrogatoire: each question answered, the answer, the answers accepted, the importance.
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'question', q.label,
        'answer', (select o.label from public.question_options o where o.id = a.option_id),
        'accepted', coalesce((select jsonb_agg(o.label order by o.position) from public.question_options o
                              where o.id = any (a.accepted_option_ids)), '[]'::jsonb),
        'importance', a.importance) order by q.position, q.id)
      from public.answers a join public.questions q on q.id = a.question_id
      where a.user_id = p_user), '[]'::jsonb),
    'activity', jsonb_build_object(
      'sent', coalesce((select jsonb_object_agg(s.status, s.n) from (
          select r.status, count(*) as n from public.visit_requests r where r.visitor_id = p_user group by r.status) s),
        '{}'::jsonb),
      'received', coalesce((select jsonb_object_agg(s.status, s.n) from (
          select r.status, count(*) as n from public.visit_requests r where r.bad_id = p_user group by r.status) s),
        '{}'::jsonb),
      'last_requests', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
          select jsonb_build_object('id', r.id, 'created_at', r.created_at,
            'direction', case when r.visitor_id = p_user then 'sent' else 'received' end,
            'other_id', o.id, 'other_pseudo', o.pseudo, 'status', r.status) as x
          from public.visit_requests r
          join public.profiles o on o.id = case when r.visitor_id = p_user then r.bad_id else r.visitor_id end
          where p_user in (r.visitor_id, r.bad_id)
          order by r.created_at desc limit 20) l), '[]'::jsonb),
      'visits_upcoming', (select count(*) from public.visits v where p_user in (v.bad_id, v.visitor_id)
                          and v.status in ('scheduled', 'in_progress') and v.ends_at > now()),
      'visits_honored', (select count(*) from public.visits v where p_user in (v.bad_id, v.visitor_id)
                         and v.status = 'ended'
                         and (v.absent is null
                              or (v.absent = 'bad' and v.visitor_id = p_user)
                              or (v.absent = 'visitor' and v.bad_id = p_user))),
      'visits_absent', (select count(*) from public.visits v where p_user in (v.bad_id, v.visitor_id)
                        and (v.absent = 'both'
                             or (v.absent = 'bad' and v.bad_id = p_user)
                             or (v.absent = 'visitor' and v.visitor_id = p_user))),
      'permits_open', (select count(*) from public.visit_requests r where p_user in (r.visitor_id, r.bad_id)
                       and r.status = 'released'),
      'cavales_proposed', (select count(*) from public.date_proposals d where d.proposer_id = p_user),
      'cavales_accepted', (select count(*) from public.date_proposals d
                           join public.conversations c on c.id = d.conversation_id
                           where p_user in (c.bad_id, c.visitor_id) and d.status = 'accepted'),
      'blocks_made', (select count(*) from public.blocks b where b.blocker_id = p_user and b.unblocked_at is null),
      'blocks_received', (select count(*) from public.blocks b where b.blocked_id = p_user and b.unblocked_at is null),
      'reports_made', (select count(*) from public.reports r where r.reporter_id = p_user),
      'reports_received', (select count(*) from public.reports r where r.target_user_id = p_user),
      'reports_open', (select count(*) from public.reports r where r.target_user_id = p_user and r.status = 'open'),
      'sanctions', coalesce((select jsonb_agg(jsonb_build_object('action', m.action, 'reason', m.reason,
          'ends_at', m.ends_at, 'created_at', m.created_at) order by m.created_at desc)
        from public.moderation_actions m where m.target_user_id = p_user
          and m.action in ('warn', 'suspend', 'ban', 'unban', 'hide_profile', 'unhide_profile', 'revoke_good_conduct')),
        '[]'::jsonb)),
    'settings', jsonb_build_object(
      'paused', p.is_paused, 'paused_at', p.paused_at,
      'requests_cap', p.requests_cap, 'requests_open', p.requests_open,
      'requests_closed_manual', p.requests_closed_manual, 'pending_requests', p.pending_requests_count,
      -- The preferences, without the unsubscribe token.
      'notifications', (select to_jsonb(np) - 'user_id' - 'unsubscribe_token' - 'push_prompt_declined_at'
                        from public.notification_preferences np where np.user_id = p_user),
      'devices', (select count(*) from public.push_subscriptions s where s.user_id = p_user and s.revoked_at is null),
      'referral_code', p.referral_code,
      'referrals', (select count(*) from public.profiles r where r.referred_by = p_user)));
end;
$$;

-- « Afficher l'e-mail »: members.email, each showing logged; an account without a profile has
-- no showing (it could not be logged).
create function public.admin_member_email(p_user uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare address text;
begin
  if not public.has_admin_permission('members.email') then raise exception 'admin_only' using errcode = '42501'; end if;
  -- Only a member with a profile: the showing must be logged, and the log is about a profile.
  select u.email into address from auth.users u join public.profiles p on p.id = u.id where u.id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.greffe_fiche_views (admin_id, bad_id, context) values ((select auth.uid()), p_user, 'email');
  return address;
end;
$$;

revoke execute on function public.admin_member_extra(uuid), public.admin_member_email(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_member_extra(uuid), public.admin_member_email(uuid) to authenticated;
