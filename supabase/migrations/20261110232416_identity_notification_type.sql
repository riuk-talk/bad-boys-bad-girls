-- 10e: the decision of the Greffe on a request to correct the date of birth reaches the member
-- (in its own migration: a value cannot be used in the transaction that adds it).
alter type public.notification_type add value if not exists 'birthdate_correction';
