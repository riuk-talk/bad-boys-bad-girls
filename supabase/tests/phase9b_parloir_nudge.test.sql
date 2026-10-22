-- Phase 9b (pgTAP): la relance à 48 h du Parloir sans horaire (SPEC §13 [P1]). Every test_*
-- function runs in its own rolled-back transaction (runtests).

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

create function pg_temp.nudge(p_member uuid, p_conversation uuid) returns boolean language plpgsql as $$
declare r boolean;
begin
  perform pg_temp.as_user(p_member);
  r := (public.get_conversation(p_conversation) ->> 'nudge')::boolean;
  perform pg_temp.as_owner();
  return r;
end $$;

create function pg_temp.test_nudge() returns setof text language plpgsql as $$
declare b uuid := pg_temp.new_member('bad'); v uuid := pg_temp.new_member('visitor');
  outsider uuid := pg_temp.new_member('visitor'); c uuid;
begin
  insert into public.conversations (bad_id, visitor_id, status, released_at, last_message_at)
  values (b, v, 'open', now() - interval '47 hours', now() - interval '30 hours') returning id into c;
  return next ok(not pg_temp.nudge(v, c), 'not before 48 h of Permis permanent');

  update public.conversations set released_at = now() - interval '49 hours',
    last_message_at = now() - interval '23 hours' where id = c;
  return next ok(not pg_temp.nudge(v, c), 'not while the last message is less than 24 h old');

  update public.conversations set last_message_at = now() - interval '25 hours' where id = c;
  return next ok(pg_temp.nudge(v, c) and pg_temp.nudge(b, c), '48 h, quiet for 24 h, no Cavale: both see it');

  perform pg_temp.as_user(v);
  perform public.ack_parloir_nudge(c);
  perform pg_temp.as_owner();
  return next ok(not pg_temp.nudge(v, c), 'once shown, never again for that member');
  return next ok(pg_temp.nudge(b, c), 'the other member still has theirs');

  perform pg_temp.as_user(outsider);
  perform public.ack_parloir_nudge(c);
  perform pg_temp.as_owner();
  return next ok((select bad_nudged_at is null from public.conversations where id = c),
    'an outsider marks nothing');

  insert into public.date_proposals (conversation_id, proposer_id, venue_type, venue_name, starts_at, status)
  values (c, b, 'bar', 'Le Bar test', now() + interval '2 days', 'cancelled');
  return next ok(not pg_temp.nudge(b, c), 'a Cavale proposed once, even cancelled: no relance');

  delete from public.date_proposals where conversation_id = c;
  update public.conversations set status = 'closed' where id = c;
  return next ok(not pg_temp.nudge(b, c), 'not in a closed case');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
