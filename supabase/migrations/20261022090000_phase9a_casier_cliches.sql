-- Phase 9a [P1]: les clichés déconseillés du Casier (SPEC §6). A list in the database (FR + EN) of
-- generic formulas; the Casier assistant and « Teste ton Casier » advise against them, never block.
-- `needs_detail`: the formula is only a cliché when the line says nothing more (« tapage nocturne »
-- alone). Members read the active list through one function; nobody writes it but migrations.

create table public.casier_cliches (
  id smallint generated always as identity primary key,
  lang text not null check (lang in ('fr', 'en')),
  phrase text not null check (char_length(phrase) between 3 and 60),
  needs_detail boolean not null default false,
  is_active boolean not null default true,
  unique (lang, phrase)
);
alter table public.casier_cliches enable row level security;
revoke all on public.casier_cliches from public, anon, authenticated;

insert into public.casier_cliches (lang, phrase, needs_detail) values
  ('fr', 'vol de cœur', false),
  ('fr', 'excès de charme', false),
  ('fr', 'trop beau', false),
  ('fr', 'trop belle', false),
  ('fr', 'séduction non autorisée', false),
  ('fr', 'briseur de cœur', false),
  ('fr', 'briseuse de cœur', false),
  ('fr', 'coupable d''être moi-même', false),
  ('fr', 'tapage nocturne', true),
  ('fr', 'récidiviste de l''amour', false),
  ('en', 'heart thief', false),
  ('en', 'stealing hearts', false),
  ('en', 'too much charm', false),
  ('en', 'too handsome', false),
  ('en', 'too pretty', false),
  ('en', 'unauthorized seduction', false),
  ('en', 'heartbreaker', false),
  ('en', 'guilty of being myself', false),
  ('en', 'disturbing the peace', true),
  ('en', 'repeat offender of love', false);

-- The active list, both languages (a Casier may be written in either).
create function public.get_casier_cliches()
returns table (phrase text, needs_detail boolean)
language sql stable security definer set search_path = '' as $$
  select c.phrase, c.needs_detail from public.casier_cliches c
  where c.is_active and (select auth.uid()) is not null
  order by c.lang, c.id
$$;
revoke execute on function public.get_casier_cliches() from public, anon, authenticated, service_role;
grant execute on function public.get_casier_cliches() to authenticated;
