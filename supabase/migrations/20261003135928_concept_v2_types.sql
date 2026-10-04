-- Concept v2 (SPEC v7, SCHEMA v2 §6), part 1: extension and types.
-- Kept apart from part 2 because new enum values cannot be used in the transaction that adds them.
create extension if not exists btree_gist with schema extensions;

create type public.member_role as enum ('bad', 'visitor');

alter type public.email_kind rename value 'plea_digest' to 'request_digest';
alter type public.email_kind add value if not exists 'visit_reminder';
alter type public.email_kind add value if not exists 'permit_granted';
alter type public.email_kind add value if not exists 'admin_zone_ready';

alter type public.flag_source rename value 'plea' to 'visit_request';
alter type public.flag_source add value if not exists 'visit_motive' after 'bio';
