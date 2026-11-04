-- Phase 9l (pgTAP): the private Realtime channel of « … écrit » (owner's decision 2026-11-04).
-- Only the two members of a conversation may listen to or send on `parloir-typing:<id>`; a
-- stranger, an anonymous visitor, a blocked pair and any other private topic are refused.
-- Nothing of it is stored by the site. Every test_* function runs in its own rolled-back
-- transaction (runtests).

create function pg_temp.new_member(p_role public.member_role) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid(); place bigint;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    uid || '@test.local', '', now(), '{}', '{}', now(), now());
  insert into public.places (official_code, name, lat, lng)
  values ('N' || substr(md5(random()::text), 1, 8), 'Ville test', 47.5, 3.5) returning id into place;
  insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, place_id, role, visit_motive)
  values (uid, 'n' || translate(substr(replace(uid::text, '-', ''), 1, 12), '0123456789', 'ghijklmnop'),
    date '1990-01-01', 'woman', '{man,woman}', place, p_role,
    case when p_role = 'visitor' then 'Motif de test' end);
  return uid;
end $$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- What Realtime Authorization does when a member joins (select) or sends (insert) on a topic:
-- the topic in realtime.topic(), the row checked by the policies of realtime.messages.
create function pg_temp.can_listen(p_member uuid, p_topic text) returns boolean language plpgsql as $$
declare n integer;
begin
  -- A signal on the topic, written by the database owner; then read as the member.
  insert into realtime.messages (topic, extension, payload, event, private)
    values (p_topic, 'broadcast', '{}', 'probe', true);
  perform set_config('realtime.topic', p_topic, true);
  if p_member is null then
    execute 'set local role anon';
  else
    perform pg_temp.as_user(p_member);
  end if;
  select count(*) into n from realtime.messages where topic = p_topic and event = 'probe';
  perform pg_temp.as_owner();
  delete from realtime.messages where topic = p_topic and event = 'probe';
  return n > 0;
end $$;

create function pg_temp.can_send(p_member uuid, p_topic text) returns boolean language plpgsql as $$
begin
  perform set_config('realtime.topic', p_topic, true);
  perform pg_temp.as_user(p_member);
  insert into realtime.messages (topic, extension, payload, event, private)
    values (p_topic, 'broadcast', '{"typing":true}', 'typing', true);
  perform pg_temp.as_owner();
  delete from realtime.messages where topic = p_topic and event = 'typing';
  return true;
exception when insufficient_privilege then
  perform pg_temp.as_owner();
  return false;
end $$;

create function pg_temp.test_typing_channel_members_only() returns setof text language plpgsql as $$
declare
  b uuid := pg_temp.new_member('bad');
  v uuid := pg_temp.new_member('visitor');
  outsider uuid := pg_temp.new_member('visitor');
  c uuid;
  topic text;
begin
  insert into public.conversations (bad_id, visitor_id, status, released_at)
    values (b, v, 'open', now()) returning id into c;
  topic := 'parloir-typing:' || c;
  return next ok(pg_temp.can_send(v, topic) and pg_temp.can_send(b, topic),
    'the two members may send « … écrit »');
  return next ok(pg_temp.can_listen(v, topic) and pg_temp.can_listen(b, topic),
    'and listen to it');
  return next ok(not pg_temp.can_send(outsider, topic), 'a stranger cannot send on it');
  return next ok(not pg_temp.can_listen(outsider, topic), 'nor listen to it');
  return next ok(not pg_temp.can_listen(null, topic), 'nor an anonymous visitor');
  return next ok(not pg_temp.can_send(v, 'parloir-typing:not-a-uuid')
                 and not pg_temp.can_send(v, 'parloir:' || c)
                 and not pg_temp.can_send(v, 'anything-else'),
    'another or malformed private topic stays closed');
  insert into public.blocks (blocker_id, blocked_id) values (b, v);
  return next ok(not pg_temp.can_send(v, topic) and not pg_temp.can_listen(b, topic),
    'a blocked pair is refused, both ways');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
