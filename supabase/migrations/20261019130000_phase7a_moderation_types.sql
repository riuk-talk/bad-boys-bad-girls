-- Phase 7a: new enum values, in their own migration (a value cannot be used in the transaction
-- that adds it).
alter type public.notification_type add value if not exists 'report_decided';
alter type public.notification_type add value if not exists 'sanction';
alter type public.case_close_reason add value if not exists 'moderation';
