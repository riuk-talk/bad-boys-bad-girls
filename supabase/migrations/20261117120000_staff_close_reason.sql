-- 10f: requests closed because one of the two members received an administration role (the
-- others are told with the usual neutral notice). In its own migration: a value cannot be used in
-- the transaction that adds it.
alter type public.case_close_reason add value if not exists 'staff_role';
