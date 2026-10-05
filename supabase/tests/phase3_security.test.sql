-- Phase 3a security tests (pgTAP, xUnit style): QCM, Casier, 8-step onboarding.
-- Every test_* function runs in its own rolled-back transaction (runtests), so nothing persists.
-- Run: `supabase test db`, or paste this file into the SQL editor / Supabase connector.

----------------------------------------------------------------------------------------------
-- Helpers
----------------------------------------------------------------------------------------------
create function pg_temp.new_user(p_email text) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email, '',
    now(), '{}', '{}', now(), now());
  return uid;
end $$;

create function pg_temp.new_place(p_name text, p_lat double precision, p_lng double precision)
returns bigint language sql as $$
  insert into public.places (official_code, name, lat, lng)
  values ('T' || substr(md5(random()::text), 1, 8), p_name, p_lat, p_lng) returning id
$$;

-- Member with a profile, created as the database owner (bypasses RLS on purpose).
create function pg_temp.new_member(p_email text, p_gender public.gender default 'woman',
  p_place bigint default null, p_role public.member_role default 'bad') returns uuid language plpgsql as $$
declare uid uuid := pg_temp.new_user(p_email);
begin
  insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, place_id, role, visit_motive)
  values (uid, 'm' || translate(substr(replace(uid::text, '-', ''), 1, 12), '0123456789', 'ghijklmnop'), date '1990-01-01', p_gender,
    '{man,woman}', p_place, p_role, case when p_role = 'visitor' then 'Motif de test' end);
  return uid;
end $$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Runs a statement as the current role; returns null on success, else "SQLSTATE message".
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- Runs a query returning one value as the current role.
create function pg_temp.val(p_sql text) returns text language plpgsql as $$
declare result text;
begin
  execute p_sql into result;
  return result;
end $$;

-- Detail of the error raised by a statement (complete_onboarding lists what is missing), or null.
create function pg_temp.error_detail(p_sql text) returns text language plpgsql as $$
declare d text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end $$;

-- The core answers (option 1 everywhere), as the database owner; p_skip leaves one question out.
create function pg_temp.answer_core(p_user uuid, p_skip smallint default null) returns void language sql as $$
  insert into public.answers (user_id, question_id, option_id)
  select p_user, q.id, q.id * 10 + 1 from public.questions q
  where q.phase = 'core' and q.is_active and q.id is distinct from p_skip
$$;

-- Everything but the Casier and the QCM for the 8-step onboarding (consents, photo 0).
create function pg_temp.common_steps(p_user uuid) returns void language plpgsql as $$
declare t text;
begin
  foreach t in array array['terms', 'privacy', 'age_18', 'art9_seeking'] loop
    insert into public.consents (user_id, type, text_version, granted) values (p_user, t::public.consent_type, 'v1', true);
  end loop;
  insert into public.photos (owner_id, position, pending_path) values (p_user, 0, p_user || '/0.webp');
end $$;

----------------------------------------------------------------------------------------------
-- Structure
----------------------------------------------------------------------------------------------
create function pg_temp.test_phase3_structure() returns setof text language plpgsql as $$
begin
  return next is(
    (select array_agg(relname::text order by relname) from pg_class
     where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity
       and relname in ('questions', 'question_options', 'answers', 'casier_charges')),
    null, 'RLS is enabled on the four Phase 3 tables');
  return next is((select count(*)::int from public.questions where phase = 'core' and is_active), 10, '10 core questions');
  return next is((select count(*)::int from public.questions where phase = 'extra' and is_active), 10, '10 extra questions');
  return next is(
    (select count(*)::int from public.questions q
     where (select count(*) from public.question_options o where o.question_id = q.id) not between 3 and 4),
    0, 'every question has 3 or 4 options');
  return next is(
    (select count(*)::int from public.question_options where label ->> 'fr' = '' or label ->> 'en' = ''),
    0, 'every option is labelled in French and English');
  return next is(
    (select array_agg(table_name::text || ':' || privilege_type order by table_name, privilege_type)
     from information_schema.role_table_grants
     where grantee = 'anon' and table_name in ('questions', 'question_options', 'answers', 'casier_charges')),
    null, 'anon has no privilege on the Phase 3 tables');
end $$;

----------------------------------------------------------------------------------------------
-- Onboarding in 8 steps (SPEC §4)
----------------------------------------------------------------------------------------------
create function pg_temp.test_onboarding_step_bounds() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local');
begin
  perform pg_temp.as_user(a);
  return next is(pg_temp.try(format('update public.profiles set onboarding_step = 8 where id = %L', a)), null,
    'step 8 (the QCM) is accepted');
  return next matches(coalesce(pg_temp.try(format('update public.profiles set onboarding_step = 9 where id = %L', a)), 'ok'),
    '^23514', 'step 9 is refused');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_complete_onboarding_bad() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local', 'woman', pg_temp.new_place('Ville', 43.1, 5.9));
begin
  perform pg_temp.common_steps(a);
  perform pg_temp.as_user(a);
  return next is(pg_temp.error_detail('select public.complete_onboarding()'), 'casier,core_answers',
    'a Bad cannot finish without the Casier and the 10 core answers');
  perform pg_temp.as_owner();
  perform pg_temp.answer_core(a);
  perform pg_temp.as_user(a);
  return next is(pg_temp.error_detail('select public.complete_onboarding()'), 'casier',
    'with the QCM but no Casier, still refused');
  return next is(pg_temp.try(format(
    'insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index) values (%L, %L, %L, %L, 2)',
    a, 'A traversé l''Espagne à moto sans réserver une seule nuit.', 'S''est fait sortir d''un karaoké.',
    'A un tatouage dont personne ne connaît le sens.')), null, 'the Bad writes the Casier');
  return next is(pg_temp.try('select public.complete_onboarding()'), null, 'then the Bad finishes');
  return next is(pg_temp.val(format('select onboarding_step from public.profiles where id = %L', a)), '8',
    'onboarding_step = 8 at the end');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_complete_onboarding_visitor() returns setof text language plpgsql as $$
declare v uuid := pg_temp.new_member('v@test.local', 'man', pg_temp.new_place('Ville', 43.1, 5.9), 'visitor');
begin
  perform pg_temp.common_steps(v);
  perform pg_temp.as_user(v);
  return next is(pg_temp.error_detail('select public.complete_onboarding()'), 'core_answers',
    'a Visitor needs the 10 core answers, not a Casier');
  perform pg_temp.as_owner();
  perform pg_temp.answer_core(v, 10::smallint);
  perform pg_temp.as_user(v);
  return next is(pg_temp.error_detail('select public.complete_onboarding()'), 'core_answers',
    '9 core answers are not enough');
  perform pg_temp.as_owner();
  insert into public.answers (user_id, question_id, option_id) values (v, 10, 101);
  perform pg_temp.as_user(v);
  return next is(pg_temp.try('select public.complete_onboarding()'), null, 'a Visitor finishes with the 10 answers');
  return next is(pg_temp.val(format('select onboarding_step from public.profiles where id = %L', v)), '8',
    'onboarding_step = 8 for a Visitor too');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_complete_onboarding_ignores_inactive_core() returns setof text language plpgsql as $$
declare v uuid := pg_temp.new_member('v@test.local', 'man', pg_temp.new_place('Ville', 43.1, 5.9), 'visitor');
begin
  perform pg_temp.common_steps(v);
  perform pg_temp.answer_core(v, 10::smallint);
  update public.questions set is_active = false where id = 10;
  perform pg_temp.as_user(v);
  return next is(pg_temp.try('select public.complete_onboarding()'), null,
    'a core question deactivated by the admin is no longer required');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- The Casier (SPEC §6): Bads only, masked, flagged, never readable by others
----------------------------------------------------------------------------------------------
create function pg_temp.test_casier_bad_only() returns setof text language plpgsql as $$
declare
  v uuid := pg_temp.new_member('v@test.local', 'man', null, 'visitor');
  n uuid := pg_temp.new_member('n@test.local');
begin
  perform pg_temp.as_user(v);
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index) values (%L, ''un'', ''deux'', ''trois'', 1)',
    v)), 'ok'), '^42501', 'a Visitor cannot create a Casier');
  perform pg_temp.as_owner();
  update public.profiles set role = null where id = n;
  perform pg_temp.as_user(n);
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index) values (%L, ''un'', ''deux'', ''trois'', 1)',
    n)), 'ok'), '^42501', 'a member without a role cannot create a Casier');
  perform pg_temp.as_owner();
  -- Even the database owner (bypassing RLS) cannot attach a Casier to a Visitor: the trigger refuses.
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index) values (%L, ''un'', ''deux'', ''trois'', 1)',
    v)), 'ok'), 'casier_bad_only', 'the trigger refuses a Casier for a Visitor whatever the caller');
end $$;

create function pg_temp.test_casier_masks_contacts() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local');
begin
  perform pg_temp.as_user(a);
  return next is(pg_temp.try(format(
    'insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index) values (%L, %L, %L, %L, 1)',
    a, 'Écris-moi à moi@exemple.fr pour savoir', 'Appelle le 06 12 34 56 78 un soir', 'Tout est sur insta.com/badboy')),
    null, 'the Bad writes three charges containing contacts');
  return next is(pg_temp.val(format('select charge_1 from public.casier_charges where profile_id = %L', a)),
    'Écris-moi à [•••] pour savoir', 'e-mail masked (same mask_contacts as the bio and the Motif)');
  return next is(pg_temp.val(format('select charge_2 from public.casier_charges where profile_id = %L', a)),
    'Appelle le [•••] un soir', 'phone number masked');
  return next is(pg_temp.val(format('select charge_3 from public.casier_charges where profile_id = %L', a)),
    'Tout est sur [•••]', 'link masked');
  return next is(pg_temp.try(format(
    'update public.casier_charges set charge_1 = %L where profile_id = %L', 'Mon snap : www.snap.example/moi', a)),
    null, 'the Bad edits a charge');
  return next is(pg_temp.val(format('select charge_1 from public.casier_charges where profile_id = %L', a)),
    'Mon snap : [•••]', 'masked on update too');
  return next is(pg_temp.val(format(
    'select char_length(charge_1) <= 120 from public.casier_charges where profile_id = %L', a)), 'true',
    'a masked charge stays within 120 characters');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_casier_flags_keywords_and_dates() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local');
begin
  insert into public.moderation_keywords (term, lang, category) values ('braquage', 'fr', 'other');
  perform pg_temp.as_user(a);
  return next is(pg_temp.try(format(
    'insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index) values (%L, %L, %L, %L, 3)',
    a, 'A organisé un BRAQUAGE de bonbons à six ans', 'deux', 'trois')), null,
    'a charge with a moderation keyword is accepted (flag, not block)');
  perform pg_temp.as_owner();
  return next is((select source::text || ' ' || source_id from public.flagged_texts where user_id = a),
    'casier ' || a || ':1', 'the charge is flagged for moderation with its line number');
  return next isnt((select casier_updated_at from public.profiles where id = a), null,
    'casier_updated_at is set (« Casier modifié depuis »)');
end $$;

create function pg_temp.test_casier_private() returns setof text language plpgsql as $$
declare
  a uuid := pg_temp.new_member('a@test.local');
  v uuid := pg_temp.new_member('v@test.local', 'man', null, 'visitor');
  b uuid := pg_temp.new_member('b@test.local');
begin
  insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index) values (a, 'un', 'deux', 'trois', 2);
  perform pg_temp.as_user(v);
  return next is(pg_temp.val(format('select count(*) from public.casier_charges where profile_id = %L', a)), '0',
    'a Visitor cannot read a Bad''s Casier table (only through get_fiche, without true_index, Phase 4)');
  perform pg_temp.as_user(b);
  return next is(pg_temp.val(format('select count(*) from public.casier_charges where profile_id = %L', a)), '0',
    'another Bad cannot read it either');
  return next is(pg_temp.val(format(
    'with u as (update public.casier_charges set true_index = 1 where profile_id = %L returning 1) select count(*) from u', a)),
    '0', 'nor change it');
  return next is(has_table_privilege('authenticated', 'public.casier_charges', 'delete'), false,
    'nobody deletes a Casier through the API (no delete privilege, not even for its owner)');
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try(format(
    'update public.casier_charges set profile_id = %L where profile_id = %L', b, a)), 'ok'),
    '^42501', 'the owner cannot move the Casier to someone else');
  perform pg_temp.as_anon();
  return next matches(coalesce(pg_temp.try('select count(*) from public.casier_charges'), 'ok'),
    '^42501', 'anon cannot read casier_charges');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_casier_read_only_for_ex_bad() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local');
begin
  insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index) values (a, 'un', 'deux', 'trois', 2);
  update public.profiles set role = 'visitor', visit_motive = 'Motif' where id = a;
  perform pg_temp.as_user(a);
  return next is(pg_temp.val(format('select true_index from public.casier_charges where profile_id = %L', a)), '2',
    'an ex-Bad still reads their own Casier');
  return next matches(coalesce(pg_temp.try(format(
    'update public.casier_charges set charge_1 = ''nouveau'' where profile_id = %L', a)), 'ok'),
    '^42501', 'but cannot edit it while Visitor');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Answers (SPEC §9): owner only, consistent options
----------------------------------------------------------------------------------------------
create function pg_temp.test_answers_private() returns setof text language plpgsql as $$
declare
  a uuid := pg_temp.new_member('a@test.local');
  b uuid := pg_temp.new_member('b@test.local', 'man', null, 'visitor');
begin
  perform pg_temp.answer_core(a);
  perform pg_temp.as_user(b);
  return next is(pg_temp.val(format('select count(*) from public.answers where user_id = %L', a)), '0',
    'a member never reads someone else''s answers');
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.answers (user_id, question_id, option_id) values (%L, 11, 111)', a)), 'ok'),
    '^42501', 'nor answers in someone else''s name');
  return next is((select array_agg(cmd::text || ' ' || qual) from pg_policies
    where schemaname = 'public' and tablename = 'answers'), '{"ALL (user_id = ( SELECT auth.uid() AS uid))"}',
    'a single owner-only policy covers read, write and delete');
  perform pg_temp.as_user(a);
  return next is(pg_temp.val('select count(*) from public.answers'), '10', 'the owner reads their 10 answers');
  return next matches(coalesce(pg_temp.try(format(
    'update public.answers set user_id = %L where question_id = 1', b)), 'ok'),
    '^42501', 'user_id is not updatable');
  perform pg_temp.as_anon();
  return next matches(coalesce(pg_temp.try('select count(*) from public.answers'), 'ok'), '^42501',
    'anon cannot read answers');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_answers_consistency() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local');
begin
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.answers (user_id, question_id, option_id) values (%L, 1, 21)', a)), 'ok'),
    '^23503', 'an option of another question is refused');
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.answers (user_id, question_id, option_id, accepted_option_ids) values (%L, 1, 11, ''{}'')', a)), 'ok'),
    'accepted_empty', 'accepting nothing is refused');
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.answers (user_id, question_id, option_id, accepted_option_ids) values (%L, 1, 11, ''{11,21}'')', a)), 'ok'),
    'accepted_invalid_option', 'accepting an option of another question is refused');
  return next is(pg_temp.try(format(
    'insert into public.answers (user_id, question_id, option_id, accepted_option_ids, importance) values (%L, 1, 11, ''{14,12,12}'', ''essential'')',
    a)), null, 'a restricted answer is accepted');
  return next is(pg_temp.val(format('select accepted_option_ids::text from public.answers where user_id = %L and question_id = 1', a)),
    '{12,14}', 'accepted options are deduplicated and sorted');
  return next is(pg_temp.try(format(
    'update public.answers set accepted_option_ids = ''{11,12,13,14}'' where user_id = %L and question_id = 1', a)),
    null, 'accepting every option is allowed');
  return next is(pg_temp.val(format('select accepted_option_ids is null from public.answers where user_id = %L and question_id = 1', a)),
    'true', 'and stored as null (the default « all »)');
  perform pg_temp.as_owner();
  update public.questions set is_active = false where id = 20;
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.answers (user_id, question_id, option_id) values (%L, 20, 201)', a)), 'ok'),
    'question_inactive', 'an inactive question cannot be answered');
  return next is(pg_temp.val('select count(*) from public.questions where id = 20'), '0',
    'an inactive question is hidden from members');
  return next is(pg_temp.val('select count(*) from public.question_options where question_id = 20'), '0',
    'and so are its options');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Indice de complicité and common points: internal, never callable by a member
----------------------------------------------------------------------------------------------
create function pg_temp.test_complicity_internal() returns setof text language plpgsql as $$
declare
  a uuid := pg_temp.new_member('a@test.local');
  b uuid := pg_temp.new_member('b@test.local', 'man', null, 'visitor');
begin
  perform pg_temp.answer_core(a);
  perform pg_temp.answer_core(b);
  perform pg_temp.as_user(b);
  return next matches(coalesce(pg_temp.try(format('select * from public.complicity_score(%L, %L)', b, a)), 'ok'),
    '^42501', 'a member cannot call complicity_score (no answers oracle)');
  return next matches(coalesce(pg_temp.try(format('select * from public.common_points(%L, %L)', b, a)), 'ok'),
    '^42501', 'nor common_points');
  perform pg_temp.as_anon();
  return next matches(coalesce(pg_temp.try(format('select * from public.complicity_score(%L, %L)', b, a)), 'ok'),
    '^42501', 'nor anon');
  perform pg_temp.as_owner();
  return next is((select row(score, common_count, capped)::text from public.complicity_score(a, b)), '(100,10,f)',
    'same answers everywhere: 100');
  return next is((select row(score, common_count, capped)::text from public.complicity_score(a, a)), '(,0,f)',
    'no score with oneself');
end $$;

create function pg_temp.test_common_points() returns setof text language plpgsql as $$
declare
  a uuid := pg_temp.new_member('a@test.local');
  b uuid := pg_temp.new_member('b@test.local', 'man', null, 'visitor');
begin
  insert into public.answers (user_id, question_id, option_id, importance) values
    (a, 1, 11, 'low'), (a, 2, 21, 'important'), (a, 3, 31, 'essential'), (a, 4, 41, 'important'), (a, 5, 51, 'important'),
    (b, 1, 11, 'low'), (b, 2, 21, 'low'), (b, 3, 31, 'important'), (b, 4, 42, 'essential'), (b, 5, 51, 'important');
  return next is((select array_agg(question_id) from public.common_points(a, b)),
    '{3,5,2}'::smallint[], 'identical answers only, by cumulated importance (60, 20, 11), 3 by default');
  return next is((select count(*)::int from public.common_points(a, b, 10)), 4, 'question 4 differs: 4 points at most');
  return next is((select answer ->> 'fr' from public.common_points(a, b, 1)), 'Oui', 'the shared answer is labelled');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
