-- Phase 8a (pgTAP): the security surface of the database is frozen. A new function a member can
-- execute, a security definer function without a fixed search_path, a public table without RLS or a
-- function anon can execute fails here, on purpose: review it, then update the list.
-- Every test_* function runs in its own rolled-back transaction (runtests).

-- The functions of the public schema that a signed-in member may execute (reviewed in Phase 8a).
create function pg_temp.expected_member_functions() returns text[] language sql as $$
  select array[
    'accept_visit_request(p_request uuid, p_slots timestamp with time zone[])',
    'ack_parloir_nudge(p_conversation uuid)',
    'admin_approve_without_cutout(p_photo uuid, p_reason text, p_detail text, p_public_large text, p_public_small text)',
    'admin_birthdate_corrections()',
    'admin_counts()',
    'admin_dashboard()',
    'admin_decide_birthdate_correction(p_correction bigint, p_accept boolean, p_reason text)',
    'admin_decide_flag(p_flag bigint, p_decision text, p_reason text)',
    'admin_decide_photo(p_photo uuid, p_approve boolean, p_reason text, p_public_large text, p_public_small text)',
    'admin_decide_report(p_report bigint, p_upheld boolean, p_reason_reporter text, p_action moderation_action_type, p_reason_target text, p_days integer)',
    'admin_delete_role(p_role smallint)',
    'admin_find_members(p_query text)',
    'admin_flag_queue(p_limit integer)',
    'admin_grant_role(p_account text, p_role smallint)',
    'admin_keywords()',
    'admin_launch_mode()',
    'admin_list_members(p_role member_role, p_state text, p_complete boolean, p_blocked boolean, p_page integer)',
    'admin_member(p_user uuid)',
    'admin_member_detail(p_user uuid)',
    'admin_moderation_log(p_limit integer)',
    'admin_permission_keys()',
    'admin_photo_batch(p_limit integer)',
    'admin_photo_cutouts(p_ids uuid[])',
    'admin_photo_queue(p_limit integer)',
    'admin_photos_to_cut_out(p_ids uuid[])',
    'admin_questions()',
    'admin_replace_public_photo(p_photo uuid, p_large text, p_small text)',
    'admin_report_queue(p_limit integer)',
    'admin_revoke_role(p_user uuid)',
    'admin_roles_list()',
    'admin_sanction(p_user uuid, p_action moderation_action_type, p_reason text, p_days integer)',
    'admin_save_keyword(p_term text, p_lang text, p_category report_category, p_active boolean, p_keyword integer)',
    'admin_save_question(p_question smallint, p_label_fr text, p_label_en text, p_active boolean, p_options jsonb)',
    'admin_save_role(p_name text, p_permissions text[], p_role smallint, p_description text)',
    'admin_save_tribe(p_slug text, p_label_fr text, p_label_en text, p_sort smallint, p_active boolean, p_tribe smallint)',
    'admin_save_zone(p_slug text, p_name text, p_center_place bigint, p_radius_km smallint, p_timezone text, p_threshold_bads integer, p_women_pct smallint, p_men_pct smallint, p_auto_open boolean, p_zone smallint)',
    'admin_search_members(p_query text)',
    'admin_set_launch_mode(p_mode launch_mode)',
    'admin_set_zone_status(p_zone smallint, p_status zone_status)',
    'admin_store_cutout(p_photo uuid, p_pending_path text)',
    'admin_team()',
    'admin_team_history(p_limit integer)',
    'admin_tribes()',
    'admin_unconfirmed_accounts()',
    'admin_view_discover(p_cursor_created timestamp with time zone, p_cursor_id uuid, p_limit integer)',
    'admin_view_fiche(p_bad uuid)',
    'admin_view_promenade(p_zone smallint, p_date date)',
    'admin_view_visitors(p_gender gender, p_age_min integer, p_age_max integer, p_zone smallint, p_page integer)',
    'admin_waive_cutout(p_photo uuid, p_reason text, p_detail text)',
    'admin_web_vitals(p_days integer)',
    'admin_zone_health(p_zone smallint, p_from date, p_to date)',
    'admin_zone_names()',
    'admin_zones()',
    'age_years(birthdate date, at date)',
    'block_user(p_target uuid)',
    'cancel_date(p_proposal uuid)',
    'cancel_visit(p_visit uuid)',
    'change_role(p_role member_role)',
    'choose_slot(p_slot uuid)',
    'choose_visit_end(p_visit uuid, p_prolong boolean)',
    'claim_referral(p_code text)',
    'close_after_absence(p_request uuid)',
    'close_conversation(p_conversation uuid)',
    'complete_onboarding()',
    'counter_date(p_proposal uuid, p_venue_type venue_type, p_venue_name text, p_starts_at timestamp with time zone)',
    'decide_visit_request(p_request uuid, p_accept boolean)',
    'decline_slots(p_request uuid)',
    'discover_bads(p_age_min integer, p_age_max integer, p_max_km integer, p_tribe_ids smallint[], p_good_conduct_only boolean, p_recently_active boolean, p_cursor_key bigint, p_cursor_id uuid, p_limit integer)',
    'export_my_data()',
    'get_casier_cliches()',
    'get_conversation(p_conversation uuid)',
    'get_dates(p_conversation uuid)',
    'get_fiche(p_bad uuid)',
    'get_mailbox()',
    'get_messages(p_conversation uuid, p_after bigint)',
    'get_my_blocks()',
    'get_my_decisions()',
    'get_my_parloirs()',
    'get_my_promenade()',
    'get_my_requests()',
    'get_my_sanction()',
    'get_my_visits()',
    'get_permit(p_visitor uuid)',
    'get_read_state(p_conversation uuid)',
    'get_request_schedule(p_request uuid)',
    'get_unread_counts()',
    'get_visit(p_visit uuid)',
    'has_admin_permission(p_permission text)',
    'has_contacts(value text)',
    'immutable_unaccent(value text)',
    'is_admin()',
    'join_visit(p_visit uuid)',
    'mark_conversation_read(p_conversation uuid, p_up_to bigint)',
    'mark_notifications_read()',
    'mark_notifications_read(p_types notification_type[])',
    'mark_promenade_seen(p_bad uuid)',
    'mask_contacts(value text)',
    'my_admin_permissions()',
    'my_admin_role()',
    'my_identity_history()',
    'new_referral_code()',
    'normalize_text(value text)',
    'onboarding_missing()',
    'place_zone(p_place bigint)',
    'prepare_my_account_deletion()',
    'propose_date(p_conversation uuid, p_venue_type venue_type, p_venue_name text, p_starts_at timestamp with time zone)',
    'propose_slots(p_request uuid, p_slots timestamp with time zone[])',
    'pseudo_next_change()',
    'push_device_count()',
    'referral_count()',
    'report(p_target_type report_target, p_target_id text, p_category report_category, p_comment text)',
    'request_birthdate_correction(p_birthdate date, p_reason text)',
    'respond_date(p_proposal uuid, p_accept boolean)',
    'revoke_push_subscription(p_endpoint text)',
    'save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_locale text)',
    'search_empty_reason()',
    'search_places(p_query text, p_limit integer)',
    'send_message(p_conversation uuid, p_body text)',
    'send_visit_request(p_bad uuid, p_guessed_index smallint, p_note text)',
    'set_onboarding_role(p_role member_role)',
    'touch_activity()',
    'unblock_user(p_target uuid)',
    'zone_progress()'
  ]
$$;

create function pg_temp.member_functions() returns text[] language sql as $$
  select coalesce(array_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by p.proname, pg_get_function_identity_arguments(p.oid)), '{}')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
$$;

create function pg_temp.test_no_new_member_function() returns setof text language plpgsql as $$
begin
  return next is(
    (select coalesce(array_agg(f order by f), '{}') from unnest(pg_temp.member_functions()) f
     where f <> all (pg_temp.expected_member_functions())),
    '{}'::text[], 'no function beyond the reviewed list is executable by a member');
  return next is(
    (select coalesce(array_agg(f order by f), '{}') from unnest(pg_temp.expected_member_functions()) f
     where f <> all (pg_temp.member_functions())),
    '{}'::text[], 'every reviewed function still exists with the same signature');
end $$;

create function pg_temp.test_anon_executes_nothing() returns setof text language plpgsql as $$
begin
  return next is(
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
    0, 'anon executes no function of public or private');
end $$;

-- The private schema is not served by the Data API (config.toml: api.schemas); members only reach the
-- few helpers that row level security policies and triggers call on their behalf.
create function pg_temp.test_private_closed() returns setof text language plpgsql as $$
begin
  return next is(
    (select coalesce(array_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by p.proname, pg_get_function_identity_arguments(p.oid)), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute')),
    array['can_read_conversation(p_conversation uuid)', 'can_use_typing_channel(p_topic text)', 'is_database_owner_session()',
      'is_super_admin_email_hash(p_hash bytea)', 'is_super_admin_id(p_user uuid)'],
    'members execute only the reviewed helpers of private');
end $$;

create function pg_temp.test_definer_search_path() returns setof text language plpgsql as $$
begin
  return next is(
    (select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}') from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prosecdef
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not coalesce(p.proconfig @> array['search_path=""'], false)),
    '{}'::text[], 'every security definer function runs with an empty search_path');
end $$;

create function pg_temp.test_rls_everywhere() returns setof text language plpgsql as $$
begin
  return next is(
    (select coalesce(array_agg(c.relname::text order by c.relname), '{}') from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
    '{}'::text[], 'every public table has row level security');
  return next is(
    (select coalesce(array_agg(c.relname::text order by c.relname), '{}') from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm')
       and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))),
    '{}'::text[], 'no public view is readable through the API');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
