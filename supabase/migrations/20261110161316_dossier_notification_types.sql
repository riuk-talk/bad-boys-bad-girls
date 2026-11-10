-- 10d: new notification and e-mail kinds, in their own migration (a value cannot be used in the
-- transaction that adds it). « fiche_online »: the Greffe validated the last pose of a Bad whose
-- dossier is complete (finished then if it was not yet); « dossier_incomplete »: the poses are
-- validated but something else is still missing (the notification says what).
alter type public.notification_type add value if not exists 'fiche_online';
alter type public.notification_type add value if not exists 'dossier_incomplete';
alter type public.email_kind add value if not exists 'fiche_online';
alter type public.email_kind add value if not exists 'dossier_incomplete';
