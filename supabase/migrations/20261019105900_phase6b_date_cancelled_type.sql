-- Phase 6b: « Cavale annulée » is notified to the other (SPEC §16). Alone in its migration: a new
-- enum value cannot be used in the transaction that adds it (push_path, next migration).
alter type public.notification_type add value if not exists 'date_cancelled';
