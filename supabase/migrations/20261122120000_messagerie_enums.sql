-- 10g (owner's request 2026-11-22): the Messagerie du Greffe, from the team to the members. The
-- new values come in their own migration: a value cannot be used in the transaction that adds it.
alter type public.notification_type add value if not exists 'greffe_message';
alter type public.email_kind add value if not exists 'greffe_message';
alter type public.report_target add value if not exists 'greffe_message';
alter type public.moderation_action_type add value if not exists 'photo_proposal_accept';
