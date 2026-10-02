-- Extensions (SCHEMA.md §0). pg_cron lives in pg_catalog as recommended by Supabase;
-- everything else in the "extensions" schema so nothing is exposed through the public API.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists cube with schema extensions;
create extension if not exists earthdistance with schema extensions;
create extension if not exists pgtap with schema extensions;
