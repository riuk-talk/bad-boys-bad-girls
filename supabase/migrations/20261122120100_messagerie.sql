-- 10g (owner's request 2026-11-22): the Messagerie du Greffe (« Messagerie » in /admin, « Courrier
-- du Greffe » for the member). One thread per member, written by the team (permission
-- members.message) and answered by the member while it is open; never mixed with the Parloir's
-- tables. Text up to 2,000 characters, up to 5 images a message (re-encoded on the server, no
-- metadata, private bucket, short signed URLs), read receipts both ways, « … écrit » on a private
-- Broadcast channel like the Parloir. Photos « aux normes »: the team may propose a retouched pose,
-- which replaces the member's only after their « Accepter ». Every message is tied to its real
-- author, and no one may edit or delete one (retention aside). Every writing goes through the
-- functions below (security definer); the tables are read under RLS.

---------------------------------------------------------------------------------------------------
-- Permission: members.message (ticked for Admin and Modérateur; not for Observateur). Its verb is
-- a new one for the keys' format.
alter table public.admin_permissions drop constraint admin_permissions_key_check;
alter table public.admin_permissions add constraint admin_permissions_key_check
  check (key ~ '^[a-z_]+\.(view|detail|decide|edit|apply|manage|message)$');
insert into public.admin_permissions (key, kind, position) values ('members.message', 'act', 19);
insert into public.admin_role_permissions (role_id, permission)
select r.id, 'members.message' from public.admin_roles r where r.id in (1, 2)
on conflict do nothing;

-- Opening a thread is logged with the other readings of the Greffe (who read whose mail, when).
alter table public.greffe_fiche_views drop constraint greffe_fiche_views_context_check;
alter table public.greffe_fiche_views
  add constraint greffe_fiche_views_context_check check (context in ('vue', 'member', 'vue_bad', 'messagerie'));

---------------------------------------------------------------------------------------------------
-- Tables.

-- The name a member of the team signs with (« Le Greffe · Sam »); chosen by that person.
create table public.team_names (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name varchar(30) not null check (length(btrim(name)) between 2 and 30 and name !~ '[<>@/\\]'),
  updated_at timestamptz not null default now()
);

create table public.greffe_threads (
  id uuid primary key default gen_random_uuid(),
  -- One thread per member, for good: archived, it is reopened rather than doubled.
  member_id uuid not null unique references public.profiles (id) on delete cascade,
  opened_by uuid not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  last_message_at timestamptz,
  last_side text check (last_side in ('team', 'member')),
  -- Read receipts: the last message of the other side each one has seen.
  member_read_id bigint not null default 0,
  team_read_id bigint not null default 0
);
create index greffe_threads_list on public.greffe_threads (archived_at, last_message_at desc);

create table public.greffe_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.greffe_threads (id) on delete cascade,
  -- The real author, always (a member of the team, or the member): never shown to the member
  -- for the team; the label below is.
  author_id uuid not null,
  side text not null check (side in ('team', 'member')),
  author_label varchar(60),
  body varchar(2000),
  kind text not null default 'text'
    check (kind in ('text', 'photo_deposit', 'photo_proposal', 'photo_accepted', 'photo_refused')),
  -- A moderation decision: the only kind of message a suspended or banned member still receives.
  is_moderation boolean not null default false,
  -- The pose a member deposited at the Greffe from their Courrier (photo_deposit).
  pose smallint check (pose between 0 and 2),
  created_at timestamptz not null default now(),
  check (body is null or length(btrim(body)) between 1 and 2000),
  check (side = 'member' or author_label is not null)
);
create index greffe_messages_thread on public.greffe_messages (thread_id, id);
create index greffe_messages_body on public.greffe_messages using gin (to_tsvector('simple', coalesce(body, '')));

create table public.greffe_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id bigint not null references public.greffe_messages (id) on delete cascade,
  thread_id uuid not null references public.greffe_threads (id) on delete cascade,
  path text not null unique,
  width smallint not null check (width > 0),
  height smallint not null check (height > 0),
  created_at timestamptz not null default now(),
  -- The file itself is removed by the clean-up job (30 days after the archiving, 12 months at most).
  deleted_at timestamptz
);
create index greffe_attachments_message on public.greffe_attachments (message_id);

create table public.greffe_photo_proposals (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.greffe_threads (id) on delete cascade,
  message_id bigint not null unique references public.greffe_messages (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  position smallint not null check (position between 0 and 2),
  path_large text not null unique,
  path_small text not null unique,
  width smallint not null check (width > 0),
  height smallint not null check (height > 0),
  -- The server's finding on the file (secret key), never the proposer's say.
  is_cutout boolean not null default false,
  proposed_by uuid not null,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'refused', 'applied')),
  decided_at timestamptz,
  applied_at timestamptz,
  files_deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index greffe_photo_proposals_member on public.greffe_photo_proposals (member_id, status);

alter table public.team_names enable row level security;
alter table public.greffe_threads enable row level security;
alter table public.greffe_messages enable row level security;
alter table public.greffe_attachments enable row level security;
alter table public.greffe_photo_proposals enable row level security;
revoke all on public.team_names, public.greffe_threads, public.greffe_messages, public.greffe_attachments,
  public.greffe_photo_proposals from anon, authenticated;
grant select on public.greffe_threads, public.greffe_messages, public.greffe_attachments,
  public.greffe_photo_proposals to authenticated;

---------------------------------------------------------------------------------------------------
-- Who reads what.

create function private.greffe_team() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_admin_permission('members.message')
$$;

-- The member of the thread, or the team (members.message, second factor).
create function private.can_read_greffe_thread(p_thread uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.greffe_threads t where t.id = p_thread
                 and (t.member_id = (select auth.uid()) or private.greffe_team()))
$$;

-- A stored file of the Messagerie: its thread's readers only.
create function private.can_read_greffe_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.greffe_attachments a
                 where a.path = p_name and a.deleted_at is null and private.can_read_greffe_thread(a.thread_id))
      or exists (select 1 from public.greffe_photo_proposals p
                 where p_name in (p.path_large, p.path_small) and p.files_deleted_at is null
                   and private.can_read_greffe_thread(p.thread_id))
$$;

create policy "greffe threads: the member and the team" on public.greffe_threads
  for select to authenticated using ((select private.can_read_greffe_thread(id)));
create policy "greffe messages: the member and the team" on public.greffe_messages
  for select to authenticated using ((select private.can_read_greffe_thread(thread_id)));
create policy "greffe attachments: the member and the team" on public.greffe_attachments
  for select to authenticated using ((select private.can_read_greffe_thread(thread_id)));
create policy "greffe proposals: the member and the team" on public.greffe_photo_proposals
  for select to authenticated using ((select private.can_read_greffe_thread(thread_id)));

-- The messages: never edited nor deleted, by anyone (secret key included). The only deletions are
-- the cascade of a deleted account and the retention of private.greffe_retention().
create function private.greffe_messages_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and (pg_trigger_depth() > 1 or current_setting('app.greffe_retention', true) = 'on') then
    return old;
  end if;
  raise exception 'greffe_message_immutable' using errcode = '42501';
end;
$$;
create trigger greffe_messages_immutable before update or delete on public.greffe_messages
  for each row execute function private.greffe_messages_immutable();

-- Attachments: only the clean-up may set deleted_at; nothing else changes.
create function private.greffe_attachments_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or current_setting('app.greffe_retention', true) = 'on' then return old; end if;
    raise exception 'greffe_message_immutable' using errcode = '42501';
  end if;
  if (new.message_id, new.thread_id, new.path, new.width, new.height, new.created_at)
     is distinct from (old.message_id, old.thread_id, old.path, old.width, old.height, old.created_at) then
    raise exception 'greffe_message_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger greffe_attachments_guard before update or delete on public.greffe_attachments
  for each row execute function private.greffe_attachments_guard();

-- A proposal never changes its photo, its member or its author; its status only moves forward.
create function private.greffe_proposals_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or current_setting('app.greffe_retention', true) = 'on' then return old; end if;
    raise exception 'greffe_message_immutable' using errcode = '42501';
  end if;
  if (new.thread_id, new.message_id, new.member_id, new.position, new.path_large, new.path_small,
      new.proposed_by, new.created_at)
     is distinct from (old.thread_id, old.message_id, old.member_id, old.position, old.path_large,
      old.path_small, old.proposed_by, old.created_at)
     or (old.status <> new.status and not (
           (old.status = 'proposed' and new.status in ('accepted', 'refused'))
        or (old.status = 'accepted' and new.status = 'applied'))) then
    raise exception 'greffe_message_immutable' using errcode = '42501';
  end if;
  -- Accepted only by the member themself (greffe_decide_photo_proposal), never in their stead.
  if old.status = 'proposed' and new.status = 'accepted'
     and current_setting('app.greffe_member_decision', true) is distinct from new.member_id::text then
    raise exception 'member_decision_required' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger greffe_proposals_guard before update or delete on public.greffe_photo_proposals
  for each row execute function private.greffe_proposals_guard();

---------------------------------------------------------------------------------------------------
-- The private bucket of the Messagerie: <member id>/<uuid>.webp (images of the messages),
-- <member id>/proposal-<uuid>.webp and -s.webp (photos proposed by the team). Written by the
-- server only (secret key, after the functions below said yes), read by the thread's readers.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('greffe-mail', 'greffe-mail', false, 1048576, array['image/webp'])
on conflict (id) do nothing;

create policy "greffe mail: the thread's readers" on storage.objects
  for select to authenticated
  using (bucket_id = 'greffe-mail' and (select private.can_read_greffe_file(name)));

---------------------------------------------------------------------------------------------------
-- Realtime: the new messages and the read receipts (postgres_changes, under the RLS above,
-- joined with the member's token like the Parloir); « … écrit » on a private Broadcast channel.
alter publication supabase_realtime add table public.greffe_messages, public.greffe_threads;

create or replace function private.can_use_typing_channel(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_topic ~ '^parloir-typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return private.can_read_conversation(substring(p_topic from 16)::uuid);
  end if;
  -- The Courrier du Greffe (10g): the member of the thread and the team.
  if p_topic ~ '^greffe-typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return private.can_read_greffe_thread(substring(p_topic from 15)::uuid);
  end if;
  return false;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Helpers.

-- « Le Greffe » and the name the author signs with, if they chose one.
create function private.greffe_label(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select 'Le Greffe' || coalesce(' · ' || btrim((select n.name from public.team_names n where n.user_id = p_user)), '')
$$;

-- A member the team may still write to (anything): neither banned nor suspended.
create function private.greffe_reachable(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_member and p.banned_at is null
                 and (p.suspended_until is null or p.suspended_until <= now()))
$$;

-- One message as the screens read it (the member never sees author_id).
create function private.greffe_message_json(m public.greffe_messages, p_for_team boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'side', m.side, 'label', m.author_label, 'body', m.body, 'kind', m.kind,
    'is_moderation', m.is_moderation, 'pose', m.pose, 'created_at', m.created_at,
    'author_id', case when p_for_team then m.author_id end,
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'path', a.path,
        'width', a.width, 'height', a.height) order by a.created_at, a.id)
      from public.greffe_attachments a where a.message_id = m.id and a.deleted_at is null), '[]'),
    'attachments_removed', (select count(*) from public.greffe_attachments a
                            where a.message_id = m.id and a.deleted_at is not null),
    'proposal', (select jsonb_build_object('id', p.id, 'position', p.position, 'status', p.status,
        'path', case when p.files_deleted_at is null then p.path_large end,
        'width', p.width, 'height', p.height)
      from public.greffe_photo_proposals p where p.message_id = m.id))
$$;

-- A path of the bucket, for this member, that exists and is not used yet.
create function private.greffe_file_ok(p_member uuid, p_path text, p_proposal boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_path ~ ('^' || p_member::text || case when p_proposal then '/proposal-' else '/' end
                   || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
                   || case when p_proposal then '(-s)?' else '' end || '\.webp$')
    and exists (select 1 from storage.objects o where o.bucket_id = 'greffe-mail' and o.name = p_path)
    and not exists (select 1 from public.greffe_attachments a where a.path = p_path)
    and not exists (select 1 from public.greffe_photo_proposals p where p_path in (p.path_large, p.path_small))
$$;

-- Records a message and what follows: the thread's last message, the author's side read up to
-- it, the member's notice (push, e-mail once a day) when the team writes.
create function private.greffe_record(p_thread public.greffe_threads, p_side text, p_body text,
  p_kind text, p_moderation boolean, p_pose smallint default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); new_id bigint;
begin
  insert into public.greffe_messages (thread_id, author_id, side, author_label, body, kind, is_moderation, pose)
  values (p_thread.id, me, p_side, case when p_side = 'team' then private.greffe_label(me) end,
          nullif(btrim(p_body), ''), p_kind, coalesce(p_moderation, false), p_pose)
  returning id into new_id;
  update public.greffe_threads set last_message_at = now(), last_side = p_side,
    member_read_id = case when p_side = 'member' then new_id else member_read_id end,
    team_read_id = case when p_side = 'team' then new_id else team_read_id end
  where id = p_thread.id;
  if p_side = 'team' then
    perform public.notify(p_thread.member_id, 'greffe_message', jsonb_build_object('moderation', coalesce(p_moderation, false)));
  end if;
  return new_id;
end;
$$;

---------------------------------------------------------------------------------------------------
-- The team.

-- The name a member of the team signs with (their own; 2 to 30 characters), or none.
create function public.greffe_set_team_name(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.greffe_team() then raise exception 'admin_only' using errcode = '42501'; end if;
  if nullif(btrim(p_name), '') is null then
    delete from public.team_names where user_id = (select auth.uid());
  else
    insert into public.team_names (user_id, name) values ((select auth.uid()), btrim(p_name))
    on conflict (user_id) do update set name = excluded.name, updated_at = now();
  end if;
end;
$$;

create function public.greffe_my_team_name() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.greffe_team() then raise exception 'admin_only' using errcode = '42501'; end if;
  return (select n.name::text from public.team_names n where n.user_id = (select auth.uid()));
end;
$$;

-- The threads: unread first, then the most recent; filter « open », « waiting » (the member wrote
-- last) or « archived »; search on the pseudo or the text of the messages. 30 a page.
create function public.admin_messagerie_threads(p_filter text default 'open', p_query text default null,
  p_page integer default 1)
returns table (thread_id uuid, member_id uuid, pseudo text, role public.member_role, member_state text,
  archived_at timestamptz, last_message_at timestamptz, last_side text, last_preview text, unread integer,
  total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  q text := nullif(btrim(left(p_query, 60)), '');
  pattern text := '%' || replace(replace(replace(coalesce(q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  page integer := greatest(coalesce(p_page, 1), 1);
begin
  if not private.greffe_team() then raise exception 'admin_only' using errcode = '42501'; end if;
  if coalesce(p_filter, 'open') not in ('open', 'waiting', 'archived') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  return query
    with listed as (
      select t.id, t.member_id, p.pseudo::text as pseudo, p.role, private.member_state(p) as state,
        t.archived_at, t.last_message_at, t.last_side,
        (select left(coalesce(m.body, ''), 140) from public.greffe_messages m where m.thread_id = t.id
         order by m.id desc limit 1) as preview,
        (select count(*)::integer from public.greffe_messages m
         where m.thread_id = t.id and m.side = 'member' and m.id > t.team_read_id) as unread
      from public.greffe_threads t
      join public.profiles p on p.id = t.member_id
      where case coalesce(p_filter, 'open')
              when 'open' then t.archived_at is null
              when 'waiting' then t.archived_at is null and t.last_side = 'member'
              else t.archived_at is not null end
        and (q is null or p.pseudo ilike pattern
             or exists (select 1 from public.greffe_messages m where m.thread_id = t.id and m.body ilike pattern))
    )
    select l.id, l.member_id, l.pseudo, l.role, l.state, l.archived_at, l.last_message_at, l.last_side,
      l.preview, l.unread, count(*) over ()
    from listed l
    order by (l.unread > 0) desc, l.last_message_at desc nulls last, l.id
    limit 30 offset (page - 1) * 30;
end;
$$;

-- The thread of a member, created if there is none, reopened if archived (« Écrire »).
create function public.admin_messagerie_open(p_member uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t public.greffe_threads;
begin
  if not private.greffe_team() then raise exception 'admin_only' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_member)
     or exists (select 1 from public.admin_users a where a.user_id = p_member)
     or exists (select 1 from public.super_admins s where s.user_id = p_member) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into t from public.greffe_threads where member_id = p_member for update;
  if found then
    if t.archived_at is not null then
      update public.greffe_threads set archived_at = null, archived_by = null where id = t.id;
    end if;
    return t.id;
  end if;
  insert into public.greffe_threads (member_id, opened_by) values (p_member, (select auth.uid()))
  returning * into t;
  return t.id;
end;
$$;

-- A thread as the team reads it; each opening is logged (who read whose mail, when).
create function public.admin_messagerie_thread(p_thread uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare t public.greffe_threads; p public.profiles;
begin
  if not private.greffe_team() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into t from public.greffe_threads where id = p_thread;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into p from public.profiles where id = t.member_id;
  insert into public.greffe_fiche_views (admin_id, bad_id, context) values ((select auth.uid()), t.member_id, 'messagerie');
  return jsonb_build_object(
    'id', t.id, 'member_id', t.member_id, 'pseudo', p.pseudo, 'role', p.role, 'gender', p.gender,
    'member_state', private.member_state(p), 'reachable', private.greffe_reachable(t.member_id),
    'archived_at', t.archived_at, 'member_read_id', t.member_read_id, 'team_read_id', t.team_read_id,
    'messages', coalesce((select jsonb_agg(private.greffe_message_json(m, true) order by m.id)
                          from public.greffe_messages m where m.thread_id = t.id), '[]'));
end;
$$;

create function public.admin_messagerie_archive(p_thread uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.greffe_team() then raise exception 'admin_only' using errcode = '42501'; end if;
  update public.greffe_threads
  set archived_at = case when p_archived then coalesce(archived_at, now()) end,
      archived_by = case when p_archived then (select auth.uid()) end
  where id = p_thread;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end;
$$;

-- The threads of open threads with a message of the member not read by the team (menu counter).
create function public.admin_messagerie_unread() returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.greffe_team() then raise exception 'admin_only' using errcode = '42501'; end if;
  return (select count(*)::integer from public.greffe_threads t
          where t.archived_at is null and exists (select 1 from public.greffe_messages m
            where m.thread_id = t.id and m.side = 'member' and m.id > t.team_read_id));
end;
$$;

---------------------------------------------------------------------------------------------------
-- The member.

-- Their own thread (none until the team writes), without the authors' accounts.
create function public.greffe_my_thread() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.greffe_threads;
begin
  select * into t from public.greffe_threads where member_id = (select auth.uid());
  if not found then return null; end if;
  return jsonb_build_object(
    'id', t.id, 'archived_at', t.archived_at, 'member_read_id', t.member_read_id,
    'team_read_id', t.team_read_id,
    'messages', coalesce((select jsonb_agg(private.greffe_message_json(m, false) order by m.id)
                          from public.greffe_messages m where m.thread_id = t.id), '[]'));
end;
$$;

-- Messages unread by the member (bandeau of Ma fiche, notice).
create function public.greffe_my_unread() returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select count(*)::integer from public.greffe_threads t
                   join public.greffe_messages m on m.thread_id = t.id
                   where t.member_id = (select auth.uid()) and m.side = 'team' and m.id > t.member_read_id), 0)
$$;

---------------------------------------------------------------------------------------------------
-- Both sides.

-- The messages after p_after (the screens read them again on each Realtime event), with the read
-- receipts. No log: the opening already is.
create function public.greffe_messages_since(p_thread uuid, p_after bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.greffe_threads; team boolean := private.greffe_team();
begin
  select * into t from public.greffe_threads where id = p_thread;
  if not found or not (t.member_id = (select auth.uid()) or team) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'archived_at', t.archived_at, 'member_read_id', t.member_read_id, 'team_read_id', t.team_read_id,
    'messages', coalesce((select jsonb_agg(private.greffe_message_json(m, t.member_id <> (select auth.uid())) order by m.id)
                          from public.greffe_messages m where m.thread_id = t.id and m.id > coalesce(p_after, 0)), '[]'));
end;
$$;

-- Read up to p_upto (only messages of the other side move the receipt).
create function public.greffe_mark_read(p_thread uuid, p_upto bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.greffe_threads; me uuid := (select auth.uid()); upto bigint;
begin
  select * into t from public.greffe_threads where id = p_thread for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.member_id = me then
    select max(m.id) into upto from public.greffe_messages m
    where m.thread_id = t.id and m.side = 'team' and m.id <= p_upto;
    update public.greffe_threads set member_read_id = greatest(member_read_id, coalesce(upto, 0)) where id = t.id;
    update public.notifications set read_at = now()
    where user_id = me and type = 'greffe_message' and read_at is null;
  elsif private.greffe_team() then
    select max(m.id) into upto from public.greffe_messages m
    where m.thread_id = t.id and m.side = 'member' and m.id <= p_upto;
    update public.greffe_threads set team_read_id = greatest(team_read_id, coalesce(upto, 0)) where id = t.id;
  else
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- The member a file of this thread is stored under, if the caller may write in it now (the
-- server uploads the images only after this yes).
create function public.greffe_write_target(p_thread uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare t public.greffe_threads;
begin
  select * into t from public.greffe_threads where id = p_thread;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.member_id = (select auth.uid()) then
    if t.archived_at is not null then raise exception 'thread_closed' using errcode = '23514'; end if;
    return t.member_id;
  end if;
  if private.greffe_team() then return t.member_id; end if;
  raise exception 'not_found' using errcode = 'P0002';
end;
$$;

-- A message: text (2,000 characters) and/or up to 5 images already stored by the server
-- ([{path, width, height}]). The member answers only in an open thread; the team writes to a
-- suspended or banned member only a moderation decision.
create function public.greffe_send(p_thread uuid, p_body text default null, p_attachments jsonb default '[]',
  p_moderation boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  t public.greffe_threads;
  me uuid := (select auth.uid());
  side text;
  body text := nullif(btrim(p_body), '');
  files jsonb := coalesce(p_attachments, '[]');
  file jsonb;
  new_id bigint;
begin
  select * into t from public.greffe_threads where id = p_thread for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.member_id = me then
    side := 'member';
    if t.archived_at is not null then raise exception 'thread_closed' using errcode = '23514'; end if;
    if coalesce(p_moderation, false) then raise exception 'admin_only' using errcode = '42501'; end if;
    -- Plenty for a conversation with the team, too little for a flood.
    if (select count(*) from public.greffe_messages m where m.thread_id = t.id and m.side = 'member'
        and m.created_at > now() - interval '1 hour') >= 30 then
      raise exception 'greffe_rate_limit' using errcode = '23514';
    end if;
  elsif private.greffe_team() then
    side := 'team';
    if not coalesce(p_moderation, false) and not private.greffe_reachable(t.member_id) then
      raise exception 'member_unreachable' using errcode = '23514';
    end if;
  else
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(files) <> 'array' or jsonb_array_length(files) > 5 then
    raise exception 'too_many_files' using errcode = '22023';
  end if;
  if body is null and jsonb_array_length(files) = 0 then raise exception 'empty_message' using errcode = '22023'; end if;
  if length(body) > 2000 then raise exception 'message_too_long' using errcode = '22001'; end if;
  for file in select * from jsonb_array_elements(files) loop
    if not private.greffe_file_ok(t.member_id, file ->> 'path', false)
       or (file ->> 'width') !~ '^[0-9]{1,4}$' or (file ->> 'height') !~ '^[0-9]{1,4}$' then
      raise exception 'invalid_file' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct value ->> 'path') from jsonb_array_elements(files)) <> jsonb_array_length(files) then
    raise exception 'invalid_file' using errcode = '22023';
  end if;
  new_id := private.greffe_record(t, side, body, 'text', p_moderation);
  insert into public.greffe_attachments (message_id, thread_id, path, width, height)
  select new_id, t.id, value ->> 'path', (value ->> 'width')::smallint, (value ->> 'height')::smallint
  from jsonb_array_elements(files);
  return new_id;
end;
$$;

-- The member tells the Greffe, in their Courrier, of a photo they just deposited for a pose
-- (it went into the Greffe's queue like any deposit, by the usual upload).
create function public.greffe_note_deposit(p_pose smallint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare t public.greffe_threads; me uuid := (select auth.uid());
begin
  select * into t from public.greffe_threads where member_id = me for update;
  if not found or t.archived_at is not null then raise exception 'thread_closed' using errcode = '23514'; end if;
  if not exists (select 1 from public.photos ph where ph.owner_id = me and ph.position = p_pose
                 and ph.status = 'pending' and ph.created_at > now() - interval '15 minutes') then
    raise exception 'no_deposit' using errcode = '23514';
  end if;
  return private.greffe_record(t, 'member', null, 'photo_deposit', false, p_pose);
end;
$$;

-- A message of the team reported by its member (file Signalements; decided by the super admin).
create function public.greffe_report_message(p_message bigint, p_category public.report_category,
  p_comment text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); report_id bigint;
begin
  if me is null or not exists (select 1 from public.greffe_messages m join public.greffe_threads t on t.id = m.thread_id
                               where m.id = p_message and m.side = 'team' and t.member_id = me) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.reports where reporter_id = me and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'report_limit' using errcode = '23514';
  end if;
  insert into public.reports (reporter_id, target_user_id, target_type, target_id, category, comment)
  values (me, null, 'greffe_message', p_message::text, p_category, left(nullif(btrim(p_comment), ''), 500))
  returning id into report_id;
  return report_id;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Photos aux normes.

-- The team proposes a retouched photo for a pose (files already stored by the server); the member
-- sees it with « Accepter » / « Refuser ».
create function public.greffe_propose_photo(p_thread uuid, p_position smallint, p_large text, p_small text,
  p_width integer, p_height integer, p_body text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.greffe_threads; msg bigint; proposal uuid;
begin
  if not private.greffe_team() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into t from public.greffe_threads where id = p_thread for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not private.greffe_reachable(t.member_id) then raise exception 'member_unreachable' using errcode = '23514'; end if;
  if p_position not between 0 and 2
     or (p_position > 0 and exists (select 1 from public.profiles where id = t.member_id and role = 'visitor')) then
    raise exception 'invalid_position' using errcode = '22023';
  end if;
  if not private.greffe_file_ok(t.member_id, p_large, true) or not private.greffe_file_ok(t.member_id, p_small, true)
     or p_small <> regexp_replace(p_large, '\.webp$', '-s.webp') or p_large ~ '-s\.webp$' then
    raise exception 'invalid_file' using errcode = '22023';
  end if;
  if p_width not between 1 and 4000 or p_height not between 1 and 4000 then
    raise exception 'invalid_file' using errcode = '22023';
  end if;
  msg := private.greffe_record(t, 'team', p_body, 'photo_proposal', false);
  insert into public.greffe_photo_proposals (thread_id, message_id, member_id, position, path_large, path_small,
    width, height, proposed_by)
  values (t.id, msg, t.member_id, p_position, p_large, p_small, p_width, p_height, (select auth.uid()))
  returning id into proposal;
  return proposal;
end;
$$;

-- « Accepter » / « Refuser »: the member alone (never in their stead). Returns the new status.
create function public.greffe_decide_photo_proposal(p_proposal uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare p public.greffe_photo_proposals; t public.greffe_threads; me uuid := (select auth.uid());
begin
  select * into p from public.greffe_photo_proposals where id = p_proposal for update;
  if not found or p.member_id is distinct from me then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p.status <> 'proposed' then raise exception 'already_decided' using errcode = '23514'; end if;
  perform set_config('app.greffe_member_decision', me::text, true);
  update public.greffe_photo_proposals
  set status = case when p_accept then 'accepted' else 'refused' end, decided_at = now()
  where id = p.id;
  perform set_config('app.greffe_member_decision', '', true);
  select * into t from public.greffe_threads where id = p.thread_id;
  perform private.greffe_record(t, 'member', null, case when p_accept then 'photo_accepted' else 'photo_refused' end,
    false, p.position);
  return case when p_accept then 'accepted' else 'refused' end;
end;
$$;

-- After the member's « Accepter », the server (secret key) has copied the proposal into the public
-- bucket: the pose is replaced, validated at once by its proposer, and logged. Returns the files
-- of the replaced photo, for the server to remove. Never for a proposal the member has not accepted.
create function public.greffe_apply_photo_proposal(p_proposal uuid, p_public_large text, p_public_small text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.greffe_photo_proposals; ph public.photos; old jsonb := '{}';
begin
  select * into p from public.greffe_photo_proposals where id = p_proposal for update;
  if not found or p.status <> 'accepted' or p.applied_at is not null then
    raise exception 'not_accepted' using errcode = '42501';
  end if;
  if p_public_large !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
     or p_public_small <> regexp_replace(p_public_large, '\.webp$', '-s.webp') then
    raise exception 'invalid_public_path' using errcode = '22023';
  end if;
  select * into ph from public.photos where owner_id = p.member_id and position = p.position for update;
  if found then
    old := jsonb_build_object('pending', ph.pending_path, 'large', ph.public_path_large, 'small', ph.public_path_small);
  else
    insert into public.photos (owner_id, position) values (p.member_id, p.position) returning * into ph;
  end if;
  update public.photos
  set status = 'approved', pending_path = null, public_path_large = p_public_large,
      public_path_small = p_public_small, width = p.width, height = p.height, rejection_reason = null,
      reviewed_by = p.proposed_by, reviewed_at = now(), is_cutout = p.is_cutout,
      needs_cutout = false, cutout_waived = not p.is_cutout and p.position <= 2,
      cutout_waived_reason = case when not p.is_cutout and p.position <= 2
        then 'Photo retouchée par le Greffe, acceptée par le membre' end
  where id = ph.id;
  -- The Visitor's face photo delivers the Permis de visite, as a validation by the Greffe does.
  if p.position = 0 and ph.status <> 'approved'
     and exists (select 1 from public.profiles where id = p.member_id and role = 'visitor') then
    insert into public.notifications (user_id, type, payload) values (p.member_id, 'permit_granted', '{}');
  end if;
  update public.greffe_photo_proposals set status = 'applied', applied_at = now() where id = p.id;
  insert into public.moderation_actions (target_user_id, action, reason, admin_id)
  values (p.member_id, 'photo_proposal_accept',
          'Pose ' || p.position || ' remplacée par la photo proposée par le Greffe, acceptée par le membre',
          p.proposed_by);
  return old;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Retention (SPEC 10g §7): the images 30 days after the archiving and at 12 months at most, the
-- texts at 12 months; everything at the deletion of the account (cascade, files by the server).

-- The files to remove (clean-up route, secret key).
create function public.cleanup_greffe_files_due(p_limit integer default 100)
returns table (kind text, id uuid, paths text[])
language sql stable security definer set search_path = '' as $$
  (select 'attachment', a.id, array[a.path]
   from public.greffe_attachments a
   join public.greffe_threads t on t.id = a.thread_id
   where a.deleted_at is null
     and (t.archived_at < now() - interval '30 days' or a.created_at < now() - interval '12 months'))
  union all
  (select 'proposal', p.id, array[p.path_large, p.path_small]
   from public.greffe_photo_proposals p
   join public.greffe_threads t on t.id = p.thread_id
   where p.files_deleted_at is null
     and (p.status in ('refused', 'applied') or t.archived_at < now() - interval '30 days'
          or p.created_at < now() - interval '12 months'))
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

create function public.cleanup_greffe_files_done(p_attachments uuid[], p_proposals uuid[]) returns void
language sql security definer set search_path = '' as $$
  update public.greffe_attachments set deleted_at = now() where id = any (p_attachments) and deleted_at is null;
  update public.greffe_photo_proposals set files_deleted_at = now() where id = any (p_proposals) and files_deleted_at is null;
$$;

-- The texts older than 12 months, once their files are gone; then the threads left empty and
-- archived.
create function private.greffe_retention() returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  perform set_config('app.greffe_retention', 'on', true);
  delete from public.greffe_messages m
  where m.created_at < now() - interval '12 months'
    and not exists (select 1 from public.greffe_attachments a where a.message_id = m.id and a.deleted_at is null)
    and not exists (select 1 from public.greffe_photo_proposals p where p.message_id = m.id and p.files_deleted_at is null);
  get diagnostics removed = row_count;
  delete from public.greffe_threads t
  where t.archived_at < now() - interval '12 months'
    and not exists (select 1 from public.greffe_messages m where m.thread_id = t.id);
  perform set_config('app.greffe_retention', '', true);
  return removed;
end;
$$;

-- cleanup_rows (02:40) also runs the retention; cleanup_dispatch also wakes the clean-up route
-- when files of the Messagerie are due.
do $$
declare def text;
begin
  def := pg_get_functiondef('public.cleanup_rows()'::regprocedure);
  def := replace(def, 'declare pushes integer;', 'declare greffe integer; pushes integer;');
  def := replace(def, 'return jsonb_build_object(''push_outbox''',
    'greffe := private.greffe_retention();' || chr(10) || '  return jsonb_build_object(''greffe_messages'', greffe, ''push_outbox''');
  if def not like '%greffe_retention%' or def not like '%greffe integer%' then raise exception 'cleanup_rows not rewritten'; end if;
  execute def;

  def := pg_get_functiondef('public.cleanup_dispatch()'::regprocedure);
  def := replace(def, 'and not exists (select 1 from public.cleanup_photos_due(1)) then',
    'and not exists (select 1 from public.cleanup_photos_due(1))' || chr(10)
    || '     and not exists (select 1 from public.cleanup_greffe_files_due(1)) then');
  if def not like '%cleanup_greffe_files_due%' then raise exception 'cleanup_dispatch not rewritten'; end if;
  execute def;
end;
$$;

---------------------------------------------------------------------------------------------------
-- RGPD: the Courrier du Greffe in the export (texts, labels, dates, number of images).
do $$
declare def text;
begin
  def := pg_get_functiondef('public.export_my_data()'::regprocedure);
  def := replace(def, '''activity_days'', coalesce(',
    '''courrier_du_greffe'', coalesce((select jsonb_agg(jsonb_build_object(''created_at'', m.created_at,'
    || ' ''from'', case when m.side = ''team'' then m.author_label else ''moi'' end, ''kind'', m.kind,'
    || ' ''text'', m.body, ''images'', (select count(*) from public.greffe_attachments a where a.message_id = m.id))'
    || ' order by m.id) from public.greffe_messages m join public.greffe_threads t on t.id = m.thread_id'
    || ' where t.member_id = me), ''[]''),' || chr(10) || '    ''activity_days'', coalesce(');
  if def not like '%courrier_du_greffe%' then raise exception 'export_my_data not rewritten'; end if;
  execute def;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Signalements: a reported message of the team shows in the queue of the super admin only
-- (it is about the team's conduct), and is decided without a sanction of a member.
do $$
declare def text;
begin
  def := pg_get_functiondef('public.admin_report_queue(integer)'::regprocedure);
  def := replace(def, 'when ''message'' then (select m.body::text from public.messages m',
    'when ''greffe_message'' then (select g.body::text from public.greffe_messages g where g.id::text = r.target_id)'
    || chr(10) || '        when ''message'' then (select m.body::text from public.messages m');
  def := replace(def, 'where r.status = ''open''',
    'where r.status = ''open'' and (r.target_type <> ''greffe_message'' or public.has_admin_permission(''team.manage''))');
  if def not like '%greffe_messages g%' or def not like '%team.manage%' then raise exception 'admin_report_queue not rewritten'; end if;
  execute def;

  def := pg_get_functiondef('public.admin_decide_report(bigint, boolean, text, public.moderation_action_type, text, integer)'::regprocedure);
  def := replace(def, 'if not found or r.target_user_id is null then raise exception ''not_found'' using errcode = ''P0002''; end if;',
    'if not found or (r.target_user_id is null and r.target_type <> ''greffe_message'') then raise exception ''not_found'' using errcode = ''P0002''; end if;'
    || chr(10) || '  -- A message of the team (10g): the super admin decides, never a sanction of a member.'
    || chr(10) || '  if r.target_type = ''greffe_message'' then'
    || chr(10) || '    if not public.has_admin_permission(''team.manage'') then raise exception ''admin_only'' using errcode = ''42501''; end if;'
    || chr(10) || '    if p_action is not null then raise exception ''invalid_action'' using errcode = ''22023''; end if;'
    || chr(10) || '  end if;');
  def := replace(def, 'if p_upheld then' || chr(10) || '    if p_action is null',
    'if p_upheld and r.target_type = ''greffe_message'' then' || chr(10) || '    null;' || chr(10)
    || '  elsif p_upheld then' || chr(10) || '    if p_action is null');
  if def not like '%A message of the team%' or def not like '%elsif p_upheld then%' then
    raise exception 'admin_decide_report not rewritten';
  end if;
  execute def;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Notices: push (« Le Greffe t'a écrit », to the Courrier) and one e-mail a day at most.
create or replace function public.push_path(p_type public.notification_type)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'request_received' then '/courrier'
    when 'request_accepted' then '/demandes'
    when 'request_dismissed' then '/demandes'
    when 'slot_chosen' then '/visites'
    when 'visit_reminder_1h' then '/visites'
    when 'visit_starting' then '/visites'
    when 'visit_no_show' then '/visites'
    when 'visit_released' then '/visites'
    when 'visit_closed' then '/visites'
    when 'message_received' then '/visites'
    when 'date_proposed' then '/visites'
    when 'date_accepted' then '/visites'
    when 'date_countered' then '/visites'
    when 'date_cancelled' then '/visites'
    when 'promenade_open' then '/promenade'
    when 'permit_granted' then '/ma-fiche'
    when 'moderation_decision' then '/ma-fiche'
    when 'fiche_online' then '/ma-fiche'
    when 'dossier_incomplete' then '/onboarding'
    when 'birthdate_correction' then '/ma-fiche/identite'
    when 'greffe_message' then '/ma-fiche/courrier-du-greffe'
  end
$$;

do $$
declare def text;
begin
  -- Push: no other preference than the device; a suspended or banned member only for a decision.
  def := pg_get_functiondef('public.notifications_to_push()'::regprocedure);
  def := replace(def, 'if path is null then return null; end if;',
    'if path is null then return null; end if;' || chr(10)
    || '  if new.type = ''greffe_message'' and not coalesce((new.payload ->> ''moderation'')::boolean, false)'
    || chr(10) || '     and not private.greffe_reachable(new.user_id) then return null; end if;');
  def := replace(def, 'when new.type = ''message_received'' then np.push_messages',
    'when new.type = ''message_received'' then np.push_messages' || chr(10)
    || '      when new.type = ''greffe_message'' then true');
  def := replace(def, 'case when new.type = ''moderation_decision'' then ''greffe-'' || current_date::text else new.id::text end',
    'case when new.type = ''moderation_decision'' then ''greffe-'' || current_date::text'
    || ' when new.type = ''greffe_message'' then ''greffe-mail-'' || current_date::text else new.id::text end');
  if def not like '%greffe-mail-%' then raise exception 'notifications_to_push not rewritten'; end if;
  execute def;

  def := pg_get_functiondef('public.notifications_to_email()'::regprocedure);
  def := replace(def, 'when ''fiche_online'' then kind := ''fiche_online''; prio := 30;',
    'when ''fiche_online'' then kind := ''fiche_online''; prio := 30;' || chr(10)
    || '    when ''greffe_message'' then' || chr(10)
    || '      if not coalesce((new.payload ->> ''moderation'')::boolean, false) and not private.greffe_reachable(new.user_id) then'
    || chr(10) || '        return null;' || chr(10) || '      end if;' || chr(10)
    || '      kind := ''greffe_message''; prio := 20;');
  if def not like '%''greffe_message''; prio := 20%' then raise exception 'notifications_to_email not rewritten'; end if;
  execute def;
end;
$$;

-- « Le Greffe t'a écrit »: one a day at most per member (like the digests).
drop index public.email_outbox_one_per_day;
create unique index email_outbox_one_per_day on public.email_outbox (user_id, kind, not_before)
  where kind in ('request_digest', 'admin_photos_pending', 'greffe_message');

---------------------------------------------------------------------------------------------------
-- Grants.
revoke execute on function private.greffe_team(), private.can_read_greffe_thread(uuid), private.can_read_greffe_file(text),
  private.greffe_label(uuid), private.greffe_reachable(uuid), private.greffe_message_json(public.greffe_messages, boolean),
  private.greffe_file_ok(uuid, text, boolean),
  private.greffe_record(public.greffe_threads, text, text, text, boolean, smallint), private.greffe_retention()
  from public, anon, authenticated;
-- The policies call these two (they are security definer themselves).
grant execute on function private.can_read_greffe_thread(uuid), private.can_read_greffe_file(text) to authenticated;
revoke execute on function private.greffe_messages_immutable(), private.greffe_attachments_guard(),
  private.greffe_proposals_guard() from public, anon, authenticated;

revoke execute on function public.greffe_set_team_name(text), public.greffe_my_team_name(),
  public.admin_messagerie_threads(text, text, integer), public.admin_messagerie_open(uuid),
  public.admin_messagerie_thread(uuid), public.admin_messagerie_archive(uuid, boolean), public.admin_messagerie_unread(),
  public.greffe_my_thread(), public.greffe_my_unread(), public.greffe_messages_since(uuid, bigint),
  public.greffe_mark_read(uuid, bigint), public.greffe_write_target(uuid),
  public.greffe_send(uuid, text, jsonb, boolean), public.greffe_note_deposit(smallint),
  public.greffe_report_message(bigint, public.report_category, text),
  public.greffe_propose_photo(uuid, smallint, text, text, integer, integer, text),
  public.greffe_decide_photo_proposal(uuid, boolean),
  public.greffe_apply_photo_proposal(uuid, text, text),
  public.cleanup_greffe_files_due(integer), public.cleanup_greffe_files_done(uuid[], uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.greffe_set_team_name(text), public.greffe_my_team_name(),
  public.admin_messagerie_threads(text, text, integer), public.admin_messagerie_open(uuid),
  public.admin_messagerie_thread(uuid), public.admin_messagerie_archive(uuid, boolean), public.admin_messagerie_unread(),
  public.greffe_my_thread(), public.greffe_my_unread(), public.greffe_messages_since(uuid, bigint),
  public.greffe_mark_read(uuid, bigint), public.greffe_write_target(uuid),
  public.greffe_send(uuid, text, jsonb, boolean), public.greffe_note_deposit(smallint),
  public.greffe_report_message(bigint, public.report_category, text),
  public.greffe_propose_photo(uuid, smallint, text, text, integer, integer, text),
  public.greffe_decide_photo_proposal(uuid, boolean)
  to authenticated;
-- The server only (secret key): applying an accepted proposal, the clean-up of the files.
grant execute on function public.greffe_apply_photo_proposal(uuid, text, text),
  public.cleanup_greffe_files_due(integer), public.cleanup_greffe_files_done(uuid[], uuid[])
  to service_role;
