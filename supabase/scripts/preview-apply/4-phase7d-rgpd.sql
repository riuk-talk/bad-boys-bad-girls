-- bad-boys-preview (chvnmzmvcjvhxlnfmlvv) seulement. Applique la migration 20261020120000_phase7d_rgpd.sql, texte exact du fichier, puis enregistre sa ligne d'historique.
-- MD5 attendu du texte : 2f7c4c641d38142920a5974e186e5430

-- Phase 7d: RGPD (SPEC §10). The export of my data (mine only, the other person reduced to their
-- pseudo) and the real deletion of my account: my messages are erased and read « Message
-- supprimé », the conversation stays visible to the other person with « Ce compte a été
-- supprimé », my scheduled visits are cancelled, then the Auth account is deleted by the server
-- (files first) and every row follows by cascade. A banned e-mail cannot sign up again (hook of
-- Phase 2, fingerprint kept by the ban).

------------------------------------------------------------------------------------------------
-- 1. A conversation outlives the deletion of one of its two members
------------------------------------------------------------------------------------------------
alter table public.conversations
  alter column bad_id drop not null,
  alter column visitor_id drop not null,
  alter column request_id drop not null;
alter table public.conversations
  drop constraint conversations_bad_id_fkey,
  drop constraint conversations_visitor_id_fkey,
  drop constraint conversations_request_id_fkey;
alter table public.conversations
  add constraint conversations_bad_id_fkey foreign key (bad_id) references public.profiles (id) on delete set null,
  add constraint conversations_visitor_id_fkey foreign key (visitor_id) references public.profiles (id) on delete set null,
  add constraint conversations_request_id_fkey foreign key (request_id) references public.visit_requests (id) on delete set null;

-- The Parloirs sans horaire, plus the closed ones whose other member deleted their account.
create or replace function public.get_my_parloirs()
returns table (conversation_id uuid, other_id uuid, other_pseudo text, other_gender public.gender,
  other_photo_small text, released_at timestamptz, last_message_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, o.id, o.pseudo::text, o.gender,
    (select ph.public_path_small::text from public.photos ph
     where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved'),
    c.released_at, c.last_message_at
  from public.conversations c
  left join public.profiles o on o.id = case when c.bad_id = (select auth.uid()) then c.visitor_id else c.bad_id end
  where (select auth.uid()) in (c.bad_id, c.visitor_id)
    and (c.status = 'open' or (c.released_at is not null and (c.bad_id is null or c.visitor_id is null)))
    and not public.is_blocked_between(c.bad_id, c.visitor_id)
  order by coalesce(c.last_message_at, c.released_at) desc
  limit 50
$$;

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
    'other', jsonb_build_object('id', o.id, 'pseudo', o.pseudo, 'gender', o.gender,
      'photo_small', (select ph.public_path_small from public.photos ph
                      where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved')));
end;
$$;

-- A message whose author deleted their account has no sender any more: it is not mine.
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
      case when m.kind = 'text' then coalesce(m.sender_id = me, false)
           when m.system_payload ->> 'type' = 'note' then coalesce(me = c.visitor_id, false)
           else false end,
      case when m.removed_at is null then m.body::text end, m.system_payload, m.created_at
    from public.messages m
    where m.conversation_id = c.id and m.id > coalesce(p_after, 0)
    order by m.id
    limit 300;
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. The decisions of the Greffe stay append-only, except when their member is deleted
------------------------------------------------------------------------------------------------
-- The cascade from the deleted profile runs after the profile row is gone: only then may the
-- rows of that member be removed (or have a key set to null on the way).
create function public.moderation_actions_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.target_user_id is not null
     and not exists (select 1 from public.profiles p where p.id = old.target_user_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'append_only' using errcode = '42501';
end;
$$;
revoke execute on function public.moderation_actions_append_only() from public, anon, authenticated;
drop trigger moderation_actions_append_only on public.moderation_actions;
create trigger moderation_actions_append_only
  before update or delete on public.moderation_actions
  for each row execute function public.moderation_actions_append_only();

------------------------------------------------------------------------------------------------
-- 3. Export of my data (SPEC §10): mine only; the other person is their pseudo, never their text
------------------------------------------------------------------------------------------------
create function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); p public.profiles;
begin
  select * into p from public.profiles where id = me;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at)
                from auth.users u where u.id = me),
    'profile', to_jsonb(p) - 'referred_by',
    'photos', coalesce((select jsonb_agg(jsonb_build_object('position', ph.position, 'status', ph.status,
        'created_at', ph.created_at, 'reviewed_at', ph.reviewed_at, 'rejection_reason', ph.rejection_reason)
        order by ph.position) from public.photos ph where ph.owner_id = me), '[]'),
    'signes', coalesce((select jsonb_agg(jsonb_build_object('signe', t.label, 'detail', pt.detail))
        from public.profile_tribes pt join public.tribes t on t.id = pt.tribe_id where pt.profile_id = me), '[]'),
    'casier', (select to_jsonb(c) - 'profile_id' from public.casier_charges c where c.profile_id = me),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('question_id', a.question_id, 'option_id', a.option_id,
        'accepted_option_ids', a.accepted_option_ids, 'importance', a.importance) order by a.question_id)
        from public.answers a where a.user_id = me), '[]'),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('type', c.type, 'text_version', c.text_version,
        'granted', c.granted, 'created_at', c.created_at) order by c.created_at)
        from public.consents c where c.user_id = me), '[]'),
    -- Never the Casier of the Bad nor whether the bet was right (règle 14): only my own choice.
    'requests_sent', coalesce((select jsonb_agg(jsonb_build_object('created_at', r.created_at, 'bad', b.pseudo,
        'status', r.status, 'close_reason', r.close_reason, 'my_bet', r.guessed_index, 'my_note', r.note)
        order by r.created_at) from public.visit_requests r join public.profiles b on b.id = r.bad_id
        where r.visitor_id = me), '[]'),
    'requests_received', coalesce((select jsonb_agg(jsonb_build_object('created_at', r.created_at, 'visitor', v.pseudo,
        'status', r.status, 'close_reason', r.close_reason) order by r.created_at)
        from public.visit_requests r join public.profiles v on v.id = r.visitor_id where r.bad_id = me), '[]'),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('starts_at', x.starts_at, 'status', x.status,
        'with', o.pseudo, 'i_was_there', case when x.bad_id = me then x.bad_joined_at else x.visitor_joined_at end is not null)
        order by x.starts_at) from public.visits x
        join public.profiles o on o.id = case when x.bad_id = me then x.visitor_id else x.bad_id end
        where me in (x.bad_id, x.visitor_id)), '[]'),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', m.conversation_id,
        'created_at', m.created_at, 'text', m.body) order by m.id)
        from public.messages m where m.sender_id = me and m.kind = 'text' and m.removed_at is null), '[]'),
    'cavales_proposed', coalesce((select jsonb_agg(jsonb_build_object('created_at', d.created_at,
        'venue_type', d.venue_type, 'venue_name', d.venue_name, 'starts_at', d.starts_at, 'status', d.status)
        order by d.created_at) from public.date_proposals d where d.proposer_id = me), '[]'),
    'reports_made', coalesce((select jsonb_agg(jsonb_build_object('created_at', r.created_at, 'category', r.category,
        'target_type', r.target_type, 'comment', r.comment, 'status', r.status, 'decision_reason', r.decision_reason)
        order by r.created_at) from public.reports r where r.reporter_id = me), '[]'),
    'decisions_about_me', coalesce((select jsonb_agg(jsonb_build_object('created_at', m.created_at, 'action', m.action,
        'reason', m.reason, 'ends_at', m.ends_at) order by m.created_at)
        from public.moderation_actions m where m.target_user_id = me
          and m.action in ('warn', 'suspend', 'ban', 'unban', 'hide_profile', 'unhide_profile',
                           'revoke_good_conduct', 'text_remove')), '[]'),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('pseudo', o.pseudo, 'created_at', k.created_at,
        'unblocked_at', k.unblocked_at) order by k.created_at)
        from public.blocks k join public.profiles o on o.id = k.blocked_id where k.blocker_id = me), '[]'),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('type', n.type, 'created_at', n.created_at,
        'read_at', n.read_at) order by n.created_at) from public.notifications n where n.user_id = me), '[]'),
    'notification_preferences', (select to_jsonb(np) - 'user_id' - 'unsubscribe_token'
        from public.notification_preferences np where np.user_id = me),
    -- Devices without their keys or address.
    'push_devices', coalesce((select jsonb_agg(jsonb_build_object('created_at', s.created_at, 'locale', s.locale,
        'last_success_at', s.last_success_at, 'revoked_at', s.revoked_at) order by s.created_at)
        from public.push_subscriptions s where s.user_id = me), '[]'),
    'activity_days', coalesce((select jsonb_agg(a.day order by a.day) from public.activity_days a where a.user_id = me), '[]'));
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Deletion of my account: what the database does before the server deletes the Auth account
------------------------------------------------------------------------------------------------
-- My open cases are closed (the other is told neutrally, my scheduled visits are cancelled); my
-- messages are erased (« Message supprimé »); what the Parloir copied of my texts (my note, my
-- Casier in the bet) is erased too. Returns my files, which the server removes before deleting
-- the Auth account (the rows then follow by cascade).
create function public.prepare_my_account_deletion()
returns table (pending_paths text[], public_paths text[])
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform private.close_cases_of(me, 'account_deleted');
  update public.messages set body = '', removed_at = now(), system_payload = jsonb_build_object('type', 'removed')
  where sender_id = me and kind = 'text';
  delete from public.messages m
  using public.conversations c
  where m.conversation_id = c.id and m.kind = 'system'
    and ((m.system_payload ->> 'type' = 'note' and c.visitor_id = me)
      or (m.system_payload ->> 'type' = 'bet' and c.bad_id = me));
  return query
    select
      coalesce((select array_agg(ph.pending_path) from public.photos ph where ph.owner_id = me and ph.pending_path is not null), '{}'),
      coalesce((select array_agg(x.path) from public.photos ph
                cross join lateral (values (ph.public_path_large), (ph.public_path_small)) x(path)
                where ph.owner_id = me and x.path is not null), '{}');
end;
$$;

revoke execute on function public.export_my_data(), public.prepare_my_account_deletion() from public, anon;
grant execute on function public.export_my_data(), public.prepare_my_account_deletion() to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261020120000', 'phase7d_rgpd', array[$mig$-- Phase 7d: RGPD (SPEC §10). The export of my data (mine only, the other person reduced to their
-- pseudo) and the real deletion of my account: my messages are erased and read « Message
-- supprimé », the conversation stays visible to the other person with « Ce compte a été
-- supprimé », my scheduled visits are cancelled, then the Auth account is deleted by the server
-- (files first) and every row follows by cascade. A banned e-mail cannot sign up again (hook of
-- Phase 2, fingerprint kept by the ban).

------------------------------------------------------------------------------------------------
-- 1. A conversation outlives the deletion of one of its two members
------------------------------------------------------------------------------------------------
alter table public.conversations
  alter column bad_id drop not null,
  alter column visitor_id drop not null,
  alter column request_id drop not null;
alter table public.conversations
  drop constraint conversations_bad_id_fkey,
  drop constraint conversations_visitor_id_fkey,
  drop constraint conversations_request_id_fkey;
alter table public.conversations
  add constraint conversations_bad_id_fkey foreign key (bad_id) references public.profiles (id) on delete set null,
  add constraint conversations_visitor_id_fkey foreign key (visitor_id) references public.profiles (id) on delete set null,
  add constraint conversations_request_id_fkey foreign key (request_id) references public.visit_requests (id) on delete set null;

-- The Parloirs sans horaire, plus the closed ones whose other member deleted their account.
create or replace function public.get_my_parloirs()
returns table (conversation_id uuid, other_id uuid, other_pseudo text, other_gender public.gender,
  other_photo_small text, released_at timestamptz, last_message_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, o.id, o.pseudo::text, o.gender,
    (select ph.public_path_small::text from public.photos ph
     where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved'),
    c.released_at, c.last_message_at
  from public.conversations c
  left join public.profiles o on o.id = case when c.bad_id = (select auth.uid()) then c.visitor_id else c.bad_id end
  where (select auth.uid()) in (c.bad_id, c.visitor_id)
    and (c.status = 'open' or (c.released_at is not null and (c.bad_id is null or c.visitor_id is null)))
    and not public.is_blocked_between(c.bad_id, c.visitor_id)
  order by coalesce(c.last_message_at, c.released_at) desc
  limit 50
$$;

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
    'other', jsonb_build_object('id', o.id, 'pseudo', o.pseudo, 'gender', o.gender,
      'photo_small', (select ph.public_path_small from public.photos ph
                      where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved')));
end;
$$;

-- A message whose author deleted their account has no sender any more: it is not mine.
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
      case when m.kind = 'text' then coalesce(m.sender_id = me, false)
           when m.system_payload ->> 'type' = 'note' then coalesce(me = c.visitor_id, false)
           else false end,
      case when m.removed_at is null then m.body::text end, m.system_payload, m.created_at
    from public.messages m
    where m.conversation_id = c.id and m.id > coalesce(p_after, 0)
    order by m.id
    limit 300;
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. The decisions of the Greffe stay append-only, except when their member is deleted
------------------------------------------------------------------------------------------------
-- The cascade from the deleted profile runs after the profile row is gone: only then may the
-- rows of that member be removed (or have a key set to null on the way).
create function public.moderation_actions_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.target_user_id is not null
     and not exists (select 1 from public.profiles p where p.id = old.target_user_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'append_only' using errcode = '42501';
end;
$$;
revoke execute on function public.moderation_actions_append_only() from public, anon, authenticated;
drop trigger moderation_actions_append_only on public.moderation_actions;
create trigger moderation_actions_append_only
  before update or delete on public.moderation_actions
  for each row execute function public.moderation_actions_append_only();

------------------------------------------------------------------------------------------------
-- 3. Export of my data (SPEC §10): mine only; the other person is their pseudo, never their text
------------------------------------------------------------------------------------------------
create function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); p public.profiles;
begin
  select * into p from public.profiles where id = me;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at)
                from auth.users u where u.id = me),
    'profile', to_jsonb(p) - 'referred_by',
    'photos', coalesce((select jsonb_agg(jsonb_build_object('position', ph.position, 'status', ph.status,
        'created_at', ph.created_at, 'reviewed_at', ph.reviewed_at, 'rejection_reason', ph.rejection_reason)
        order by ph.position) from public.photos ph where ph.owner_id = me), '[]'),
    'signes', coalesce((select jsonb_agg(jsonb_build_object('signe', t.label, 'detail', pt.detail))
        from public.profile_tribes pt join public.tribes t on t.id = pt.tribe_id where pt.profile_id = me), '[]'),
    'casier', (select to_jsonb(c) - 'profile_id' from public.casier_charges c where c.profile_id = me),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('question_id', a.question_id, 'option_id', a.option_id,
        'accepted_option_ids', a.accepted_option_ids, 'importance', a.importance) order by a.question_id)
        from public.answers a where a.user_id = me), '[]'),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('type', c.type, 'text_version', c.text_version,
        'granted', c.granted, 'created_at', c.created_at) order by c.created_at)
        from public.consents c where c.user_id = me), '[]'),
    -- Never the Casier of the Bad nor whether the bet was right (règle 14): only my own choice.
    'requests_sent', coalesce((select jsonb_agg(jsonb_build_object('created_at', r.created_at, 'bad', b.pseudo,
        'status', r.status, 'close_reason', r.close_reason, 'my_bet', r.guessed_index, 'my_note', r.note)
        order by r.created_at) from public.visit_requests r join public.profiles b on b.id = r.bad_id
        where r.visitor_id = me), '[]'),
    'requests_received', coalesce((select jsonb_agg(jsonb_build_object('created_at', r.created_at, 'visitor', v.pseudo,
        'status', r.status, 'close_reason', r.close_reason) order by r.created_at)
        from public.visit_requests r join public.profiles v on v.id = r.visitor_id where r.bad_id = me), '[]'),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('starts_at', x.starts_at, 'status', x.status,
        'with', o.pseudo, 'i_was_there', case when x.bad_id = me then x.bad_joined_at else x.visitor_joined_at end is not null)
        order by x.starts_at) from public.visits x
        join public.profiles o on o.id = case when x.bad_id = me then x.visitor_id else x.bad_id end
        where me in (x.bad_id, x.visitor_id)), '[]'),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', m.conversation_id,
        'created_at', m.created_at, 'text', m.body) order by m.id)
        from public.messages m where m.sender_id = me and m.kind = 'text' and m.removed_at is null), '[]'),
    'cavales_proposed', coalesce((select jsonb_agg(jsonb_build_object('created_at', d.created_at,
        'venue_type', d.venue_type, 'venue_name', d.venue_name, 'starts_at', d.starts_at, 'status', d.status)
        order by d.created_at) from public.date_proposals d where d.proposer_id = me), '[]'),
    'reports_made', coalesce((select jsonb_agg(jsonb_build_object('created_at', r.created_at, 'category', r.category,
        'target_type', r.target_type, 'comment', r.comment, 'status', r.status, 'decision_reason', r.decision_reason)
        order by r.created_at) from public.reports r where r.reporter_id = me), '[]'),
    'decisions_about_me', coalesce((select jsonb_agg(jsonb_build_object('created_at', m.created_at, 'action', m.action,
        'reason', m.reason, 'ends_at', m.ends_at) order by m.created_at)
        from public.moderation_actions m where m.target_user_id = me
          and m.action in ('warn', 'suspend', 'ban', 'unban', 'hide_profile', 'unhide_profile',
                           'revoke_good_conduct', 'text_remove')), '[]'),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('pseudo', o.pseudo, 'created_at', k.created_at,
        'unblocked_at', k.unblocked_at) order by k.created_at)
        from public.blocks k join public.profiles o on o.id = k.blocked_id where k.blocker_id = me), '[]'),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('type', n.type, 'created_at', n.created_at,
        'read_at', n.read_at) order by n.created_at) from public.notifications n where n.user_id = me), '[]'),
    'notification_preferences', (select to_jsonb(np) - 'user_id' - 'unsubscribe_token'
        from public.notification_preferences np where np.user_id = me),
    -- Devices without their keys or address.
    'push_devices', coalesce((select jsonb_agg(jsonb_build_object('created_at', s.created_at, 'locale', s.locale,
        'last_success_at', s.last_success_at, 'revoked_at', s.revoked_at) order by s.created_at)
        from public.push_subscriptions s where s.user_id = me), '[]'),
    'activity_days', coalesce((select jsonb_agg(a.day order by a.day) from public.activity_days a where a.user_id = me), '[]'));
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Deletion of my account: what the database does before the server deletes the Auth account
------------------------------------------------------------------------------------------------
-- My open cases are closed (the other is told neutrally, my scheduled visits are cancelled); my
-- messages are erased (« Message supprimé »); what the Parloir copied of my texts (my note, my
-- Casier in the bet) is erased too. Returns my files, which the server removes before deleting
-- the Auth account (the rows then follow by cascade).
create function public.prepare_my_account_deletion()
returns table (pending_paths text[], public_paths text[])
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform private.close_cases_of(me, 'account_deleted');
  update public.messages set body = '', removed_at = now(), system_payload = jsonb_build_object('type', 'removed')
  where sender_id = me and kind = 'text';
  delete from public.messages m
  using public.conversations c
  where m.conversation_id = c.id and m.kind = 'system'
    and ((m.system_payload ->> 'type' = 'note' and c.visitor_id = me)
      or (m.system_payload ->> 'type' = 'bet' and c.bad_id = me));
  return query
    select
      coalesce((select array_agg(ph.pending_path) from public.photos ph where ph.owner_id = me and ph.pending_path is not null), '{}'),
      coalesce((select array_agg(x.path) from public.photos ph
                cross join lateral (values (ph.public_path_large), (ph.public_path_small)) x(path)
                where ph.owner_id = me and x.path is not null), '{}');
end;
$$;

revoke execute on function public.export_my_data(), public.prepare_my_account_deletion() from public, anon;
grant execute on function public.export_my_data(), public.prepare_my_account_deletion() to authenticated;
$mig$])
returning version, name, md5(array_to_string(statements, ';')) as md5_statements;
