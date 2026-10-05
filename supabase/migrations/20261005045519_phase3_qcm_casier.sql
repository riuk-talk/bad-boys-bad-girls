-- Phase 3a (SPEC v7.3 §4, §6, §9; SCHEMA §2.1, §2.2, §3): the QCM, the Casier and the 8-step onboarding.
-- Additive, except the onboarding_step check, which is replaced (0–7 → 0–8).

------------------------------------------------------------------------------------------------
-- 1. Types
------------------------------------------------------------------------------------------------
create type public.importance as enum ('low', 'important', 'essential');
create type public.question_phase as enum ('core', 'extra');

-- Weights of SPEC §9. Mirror: lib/complicity.ts (IMPORTANCE_WEIGHTS).
create function public.importance_weight(value public.importance)
returns integer language sql immutable parallel safe set search_path = '' as $$
  select case value when 'low' then 1 when 'important' then 10 when 'essential' then 50 end
$$;

------------------------------------------------------------------------------------------------
-- 2. Questions (reference data, labels {fr, en})
------------------------------------------------------------------------------------------------
create table public.questions (
  id smallint primary key,
  position smallint not null unique,
  phase public.question_phase not null,
  label jsonb not null check (jsonb_typeof(label -> 'fr') = 'string' and jsonb_typeof(label -> 'en') = 'string'),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.question_options (
  id smallint primary key,
  question_id smallint not null references public.questions (id) on delete cascade,
  position smallint not null,
  label jsonb not null check (jsonb_typeof(label -> 'fr') = 'string' and jsonb_typeof(label -> 'en') = 'string'),
  unique (question_id, position),
  unique (question_id, id)
);

------------------------------------------------------------------------------------------------
-- 3. Answers: owner only; other members never read them (score and common points via functions)
------------------------------------------------------------------------------------------------
create table public.answers (
  user_id uuid not null references public.profiles (id) on delete cascade,
  question_id smallint not null references public.questions (id) on delete cascade,
  option_id smallint not null,
  -- Options accepted from the other person; null = all of them (SPEC §9 default).
  accepted_option_ids smallint[],
  importance public.importance not null default 'important',
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id),
  -- The option must belong to the question.
  foreign key (question_id, option_id) references public.question_options (question_id, id) on delete cascade
);
create index answers_question on public.answers (question_id, user_id);

create function public.answers_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  all_options smallint[];
begin
  if not exists (select 1 from public.questions where id = new.question_id and is_active) then
    raise exception 'question_inactive' using errcode = '23514';
  end if;
  if new.accepted_option_ids is not null then
    select array_agg(id order by id) into all_options from public.question_options where question_id = new.question_id;
    select array_agg(distinct x order by x) into new.accepted_option_ids from unnest(new.accepted_option_ids) x;
    if new.accepted_option_ids is null then
      raise exception 'accepted_empty' using errcode = '23514';
    end if;
    if not new.accepted_option_ids <@ all_options then
      raise exception 'accepted_invalid_option' using errcode = '23514';
    end if;
    -- Accepting every option is the default: store it as null.
    if new.accepted_option_ids = all_options then new.accepted_option_ids := null; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger answers_before_write
  before insert or update on public.answers
  for each row execute function public.answers_before_write();

------------------------------------------------------------------------------------------------
-- 4. The Casier: 1 true, 2 false (SPEC §6). Bads only; contacts masked like the bio and the Motif.
------------------------------------------------------------------------------------------------
create table public.casier_charges (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  charge_1 varchar(120) not null check (btrim(charge_1) <> ''),
  charge_2 varchar(120) not null check (btrim(charge_2) <> ''),
  charge_3 varchar(120) not null check (btrim(charge_3) <> ''),
  true_index smallint not null check (true_index between 1 and 3),
  updated_at timestamptz not null default now()
);

create function public.casier_charges_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select role from public.profiles where id = new.profile_id) is distinct from 'bad' then
    raise exception 'casier_bad_only' using errcode = '42501';
  end if;
  -- The mask token can be longer than what it replaces: keep within 120 characters.
  new.charge_1 := left(btrim(public.mask_contacts(new.charge_1)), 120);
  new.charge_2 := left(btrim(public.mask_contacts(new.charge_2)), 120);
  new.charge_3 := left(btrim(public.mask_contacts(new.charge_3)), 120);
  new.updated_at := now();
  return new;
end;
$$;
create trigger casier_charges_before_write
  before insert or update on public.casier_charges
  for each row execute function public.casier_charges_before_write();

create function public.casier_charges_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.charge_1 is distinct from (case when tg_op = 'UPDATE' then old.charge_1 end) then
    perform public.flag_keywords(new.profile_id, 'casier', new.profile_id || ':1', new.charge_1);
  end if;
  if new.charge_2 is distinct from (case when tg_op = 'UPDATE' then old.charge_2 end) then
    perform public.flag_keywords(new.profile_id, 'casier', new.profile_id || ':2', new.charge_2);
  end if;
  if new.charge_3 is distinct from (case when tg_op = 'UPDATE' then old.charge_3 end) then
    perform public.flag_keywords(new.profile_id, 'casier', new.profile_id || ':3', new.charge_3);
  end if;
  -- « Casier modifié depuis » on pending requests (Phase 4).
  update public.profiles set casier_updated_at = now() where id = new.profile_id;
  return null;
end;
$$;
create trigger casier_charges_after_write
  after insert or update on public.casier_charges
  for each row execute function public.casier_charges_after_write();

------------------------------------------------------------------------------------------------
-- 5. Indice de complicité (SPEC §9). Internal: only reachable through functions that check
--    visibility (get_fiche, get_permit, get_mailbox… in Phase 4), never callable by a member.
--    Mirror: lib/complicity.ts; parity cases: tests/fixtures/complicity-cases.json.
------------------------------------------------------------------------------------------------
create function public.complicity_score(p_a uuid, p_b uuid)
returns table (score smallint, common_count integer, capped boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  n_a bigint; d_a bigint; n_b bigint; d_b bigint; cnt integer; cap boolean;
  p bigint; q bigint; s bigint;
begin
  select count(*)::integer,
    coalesce(sum(public.importance_weight(a.importance))
      filter (where a.accepted_option_ids is null or b.option_id = any (a.accepted_option_ids)), 0),
    coalesce(sum(public.importance_weight(a.importance)), 0),
    coalesce(sum(public.importance_weight(b.importance))
      filter (where b.accepted_option_ids is null or a.option_id = any (b.accepted_option_ids)), 0),
    coalesce(sum(public.importance_weight(b.importance)), 0),
    coalesce(bool_or(
      (a.importance = 'essential' and not (a.accepted_option_ids is null or b.option_id = any (a.accepted_option_ids)))
      or (b.importance = 'essential' and not (b.accepted_option_ids is null or a.option_id = any (b.accepted_option_ids)))), false)
  into cnt, n_a, d_a, n_b, d_b, cap
  from public.answers a
  join public.answers b on b.question_id = a.question_id and b.user_id = p_b
  join public.questions qu on qu.id = a.question_id and qu.is_active
  where a.user_id = p_a and p_a <> p_b;

  if cnt < 5 then
    return query select null::smallint, cnt, false;
    return;
  end if;
  -- score = round(100 × sqrt(n_a/d_a × n_b/d_b)), halves rounded up, in exact integers:
  -- the largest s with (2s − 1)² × d_a × d_b ≤ 4 × 100² × n_a × n_b.
  p := 40000 * n_a * n_b;
  q := d_a * d_b;
  s := round(100 * sqrt((n_a * n_b)::double precision / q))::bigint;
  while s > 0 and (2 * s - 1) * (2 * s - 1) * q > p loop s := s - 1; end loop;
  while (2 * s + 1) * (2 * s + 1) * q <= p loop s := s + 1; end loop;
  -- An unmet "essential" question, in either direction, caps the score at 50 %.
  if cap then s := least(s, 50); end if;
  return query select s::smallint, cnt, cap;
end;
$$;

-- The n common points: identical answers, by cumulated importance, then question order (PHASE0 R29).
create function public.common_points(p_a uuid, p_b uuid, p_n integer default 3)
returns table (question_id smallint, question jsonb, answer jsonb)
language sql stable security definer set search_path = '' as $$
  select qu.id, qu.label, o.label
  from public.answers a
  join public.answers b on b.question_id = a.question_id and b.user_id = p_b and b.option_id = a.option_id
  join public.questions qu on qu.id = a.question_id and qu.is_active
  join public.question_options o on o.id = a.option_id
  where a.user_id = p_a and p_a <> p_b
  order by public.importance_weight(a.importance) + public.importance_weight(b.importance) desc, qu.position
  limit greatest(least(p_n, 10), 0)
$$;

------------------------------------------------------------------------------------------------
-- 6. Onboarding in 8 steps (SPEC §4): Casier for the Bad, the 10 core questions for both
------------------------------------------------------------------------------------------------
alter table public.profiles drop constraint profiles_onboarding_step_check;
alter table public.profiles add constraint profiles_onboarding_step_check check (onboarding_step between 0 and 8);

create or replace function public.complete_onboarding()
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  missing text[] := '{}';
begin
  select * into me from public.profiles where id = (select auth.uid()) for update;
  if not found then raise exception 'no_profile' using errcode = 'P0002'; end if;
  if me.onboarding_completed_at is not null then return; end if;
  if me.birthdate is null then missing := missing || 'birthdate'::text; end if;
  if me.pseudo is null or me.gender is null or me.place_id is null then missing := missing || 'identity'::text; end if;
  if me.role is null then missing := missing || 'role'::text; end if;
  if cardinality(me.seeking_genders) = 0 then missing := missing || 'seeking'::text; end if;
  if exists (
    select 1 from unnest(array['terms', 'privacy', 'age_18', 'art9_seeking']::public.consent_type[]) t
    where not coalesce((select c.granted from public.consents c
                        where c.user_id = me.id and c.type = t
                        order by c.created_at desc limit 1), false)
  ) then missing := missing || 'consents'::text; end if;
  if not exists (select 1 from public.photos where owner_id = me.id and position = 0) then
    missing := missing || 'photo'::text;
  end if;
  if me.role = 'bad' and not exists (select 1 from public.casier_charges where profile_id = me.id) then
    missing := missing || 'casier'::text;
  end if;
  if me.role = 'visitor' and me.visit_motive is null then missing := missing || 'visit_motive'::text; end if;
  if exists (
    select 1 from public.questions qu
    where qu.is_active and qu.phase = 'core'
      and not exists (select 1 from public.answers an where an.user_id = me.id and an.question_id = qu.id)
  ) then missing := missing || 'core_answers'::text; end if;
  if cardinality(missing) > 0 then
    raise exception 'onboarding_incomplete' using errcode = '23514', detail = array_to_string(missing, ',');
  end if;
  update public.profiles set onboarding_completed_at = now(), onboarding_step = 8 where id = me.id;
end;
$$;

------------------------------------------------------------------------------------------------
-- 7. Row Level Security and grants
------------------------------------------------------------------------------------------------
alter table public.questions enable row level security;
alter table public.question_options enable row level security;
alter table public.answers enable row level security;
alter table public.casier_charges enable row level security;

-- Supabase grants new tables to anon/authenticated by default: start from nothing.
revoke all on public.questions, public.question_options, public.answers, public.casier_charges
  from anon, authenticated;

grant select on public.questions, public.question_options to authenticated;
create policy "active questions readable by members" on public.questions for select to authenticated
  using (is_active);
create policy "options of active questions readable by members" on public.question_options for select
  to authenticated using (exists (select 1 from public.questions qu where qu.id = question_id and qu.is_active));

grant select, delete on public.answers to authenticated;
grant insert (user_id, question_id, option_id, accepted_option_ids, importance) on public.answers to authenticated;
grant update (option_id, accepted_option_ids, importance) on public.answers to authenticated;
create policy "own answers" on public.answers for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The owner reads their Casier (an ex-Bad keeps it read-only); only a Bad writes it; nobody deletes it.
grant select on public.casier_charges to authenticated;
grant insert (profile_id, charge_1, charge_2, charge_3, true_index) on public.casier_charges to authenticated;
grant update (charge_1, charge_2, charge_3, true_index) on public.casier_charges to authenticated;
create policy "own casier readable" on public.casier_charges for select to authenticated
  using (profile_id = (select auth.uid()));
create policy "own casier insertable by a Bad" on public.casier_charges for insert to authenticated
  with check (profile_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'bad'));
create policy "own casier updatable by a Bad" on public.casier_charges for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'bad'));

revoke execute on function public.importance_weight(public.importance), public.answers_before_write(),
  public.casier_charges_before_write(), public.casier_charges_after_write(),
  public.complicity_score(uuid, uuid), public.common_points(uuid, uuid, integer)
  from public, anon, authenticated;
-- complete_onboarding keeps its grant (create or replace preserves privileges).

------------------------------------------------------------------------------------------------
-- 8. The 20 questions (SPEC §9; English: docs/content/questions-en.md). 1–10: core, 11–20: extra.
--    Option id = question id × 10 + position.
------------------------------------------------------------------------------------------------
insert into public.questions (id, position, phase, label) values
  (1, 1, 'core', '{"fr": "Ce que tu cherches ici ?", "en": "What are you looking for here?"}'),
  (2, 2, 'core', '{"fr": "Enfants ?", "en": "Kids?"}'),
  (3, 3, 'core', '{"fr": "Tabac ?", "en": "Smoking?"}'),
  (4, 4, 'core', '{"fr": "L''indépendance dans le couple ?", "en": "Independence in a relationship?"}'),
  (5, 5, 'core', '{"fr": "La jalousie en couple ?", "en": "Jealousy in a relationship?"}'),
  (6, 6, 'core', '{"fr": "Un vendredi soir idéal ?", "en": "An ideal Friday night?"}'),
  (7, 7, 'core', '{"fr": "Les règles, pour toi, c''est…", "en": "Rules, to you, are…"}'),
  (8, 8, 'core', '{"fr": "Un désaccord, tu le règles comment ?", "en": "How do you settle a disagreement?"}'),
  (9, 9, 'core', '{"fr": "Ton rythme ?", "en": "Your rhythm?"}'),
  (10, 10, 'core', '{"fr": "Alcool ?", "en": "Alcohol?"}'),
  (11, 11, 'extra', '{"fr": "Tatouages ?", "en": "Tattoos?"}'),
  (12, 12, 'extra', '{"fr": "Partir sur un coup de tête ce week-end ?", "en": "Leave on a whim this weekend?"}'),
  (13, 13, 'extra', '{"fr": "La musique qui te représente ?", "en": "The music that sums you up?"}'),
  (14, 14, 'extra', '{"fr": "Ta sortie préférée ?", "en": "Your favourite night out?"}'),
  (15, 15, 'extra', '{"fr": "On te reproche le plus souvent…", "en": "What people pick on you for most…"}'),
  (16, 16, 'extra', '{"fr": "La moto ?", "en": "Motorbikes?"}'),
  (17, 17, 'extra', '{"fr": "Les réseaux sociaux ?", "en": "Social media?"}'),
  (18, 18, 'extra', '{"fr": "Premier rendez-vous idéal ?", "en": "Ideal first date?"}'),
  (19, 19, 'extra', '{"fr": "Les animaux ?", "en": "Animals?"}'),
  (20, 20, 'extra', '{"fr": "On te dit « t''es trop bad pour moi ». Tu réponds…", "en": "Someone tells you \"you''re too bad for me\". You reply…"}');

insert into public.question_options (id, question_id, position, label) values
  (11, 1, 1, '{"fr": "Une histoire sérieuse, avec du piment", "en": "A serious story, with some spice"}'),
  (12, 1, 2, '{"fr": "Voir où ça mène", "en": "See where it goes"}'),
  (13, 1, 3, '{"fr": "Du fun sans prise de tête", "en": "Fun without the headache"}'),
  (14, 1, 4, '{"fr": "Des complices de sortie", "en": "Sidekicks for going out"}'),
  (21, 2, 1, '{"fr": "J''en ai", "en": "I have some"}'),
  (22, 2, 2, '{"fr": "J''en veux", "en": "I want some"}'),
  (23, 2, 3, '{"fr": "Pas pour moi", "en": "Not for me"}'),
  (24, 2, 4, '{"fr": "Pas encore décidé", "en": "Not decided yet"}'),
  (31, 3, 1, '{"fr": "Oui", "en": "Yes"}'),
  (32, 3, 2, '{"fr": "Parfois", "en": "Sometimes"}'),
  (33, 3, 3, '{"fr": "Non", "en": "No"}'),
  (34, 3, 4, '{"fr": "Non, et ça me dérange", "en": "No, and it bothers me"}'),
  (41, 4, 1, '{"fr": "Non négociable", "en": "Non-negotiable"}'),
  (42, 4, 2, '{"fr": "Importante, mais on partage beaucoup", "en": "Important, but we share a lot"}'),
  (43, 4, 3, '{"fr": "Je préfère tout faire à deux", "en": "I''d rather do everything together"}'),
  (51, 5, 1, '{"fr": "Zéro, chacun sa liberté", "en": "Zero, everyone keeps their freedom"}'),
  (52, 5, 2, '{"fr": "Un peu, c''est humain", "en": "A little, it''s human"}'),
  (53, 5, 3, '{"fr": "J''ai besoin d''être rassuré·e", "en": "I need reassurance"}'),
  (54, 5, 4, '{"fr": "C''est un sujet à poser tôt", "en": "It''s a topic to raise early"}'),
  (61, 6, 1, '{"fr": "Bar rock jusqu''à la fermeture", "en": "Rock bar until closing time"}'),
  (62, 6, 2, '{"fr": "Balade moto de nuit", "en": "Night ride on a motorbike"}'),
  (63, 6, 3, '{"fr": "Canapé et film d''action", "en": "Sofa and an action film"}'),
  (64, 6, 4, '{"fr": "Je décide sur le moment", "en": "I decide on the spot"}'),
  (71, 7, 1, '{"fr": "Faites pour être contournées", "en": "Made to be bent"}'),
  (72, 7, 2, '{"fr": "Je les respecte si elles ont du sens", "en": "I follow them if they make sense"}'),
  (73, 7, 3, '{"fr": "J''écris les miennes", "en": "I write my own"}'),
  (74, 7, 4, '{"fr": "Je les suis, en râlant", "en": "I follow them, grumbling"}'),
  (81, 8, 1, '{"fr": "Cash, tout de suite", "en": "Straight up, right away"}'),
  (82, 8, 2, '{"fr": "J''attends de redescendre", "en": "I wait until I''ve cooled down"}'),
  (83, 8, 3, '{"fr": "Avec humour", "en": "With humour"}'),
  (84, 8, 4, '{"fr": "Je boude un peu (j''avoue)", "en": "I sulk a bit (I admit it)"}'),
  (91, 9, 1, '{"fr": "Couche-tard", "en": "Night owl"}'),
  (92, 9, 2, '{"fr": "Lève-tôt", "en": "Early bird"}'),
  (93, 9, 3, '{"fr": "Aucun rythme", "en": "No rhythm at all"}'),
  (94, 9, 4, '{"fr": "Ça dépend de la semaine", "en": "Depends on the week"}'),
  (101, 10, 1, '{"fr": "Souvent en soirée", "en": "Often on nights out"}'),
  (102, 10, 2, '{"fr": "De temps en temps", "en": "Now and then"}'),
  (103, 10, 3, '{"fr": "Rarement", "en": "Rarely"}'),
  (104, 10, 4, '{"fr": "Jamais", "en": "Never"}'),
  (111, 11, 1, '{"fr": "J''en ai plein", "en": "Loads"}'),
  (112, 11, 2, '{"fr": "Quelques-uns", "en": "A few"}'),
  (113, 11, 3, '{"fr": "Aucun, mais j''adore", "en": "None, but I love them"}'),
  (114, 11, 4, '{"fr": "Pas mon truc", "en": "Not my thing"}'),
  (121, 12, 1, '{"fr": "Mon sac est déjà prêt", "en": "My bag is already packed"}'),
  (122, 12, 2, '{"fr": "Oui, si ce n''est pas trop loin", "en": "Yes, if it''s not too far"}'),
  (123, 12, 3, '{"fr": "J''ai besoin d''un minimum de plan", "en": "I need a bit of a plan"}'),
  (124, 12, 4, '{"fr": "Non merci", "en": "No thanks"}'),
  (131, 13, 1, '{"fr": "Rock / metal", "en": "Rock / metal"}'),
  (132, 13, 2, '{"fr": "Rap / hip-hop", "en": "Rap / hip-hop"}'),
  (133, 13, 3, '{"fr": "Électro", "en": "Electro"}'),
  (134, 13, 4, '{"fr": "Un peu de tout", "en": "A bit of everything"}'),
  (141, 14, 1, '{"fr": "Concert", "en": "A gig"}'),
  (142, 14, 2, '{"fr": "Bar ou club", "en": "Bar or club"}'),
  (143, 14, 3, '{"fr": "Road trip", "en": "Road trip"}'),
  (144, 14, 4, '{"fr": "Soirée chez des potes", "en": "An evening at friends''"}'),
  (151, 15, 1, '{"fr": "D''être trop franc·he", "en": "Being too blunt"}'),
  (152, 15, 2, '{"fr": "D''être en retard", "en": "Being late"}'),
  (153, 15, 3, '{"fr": "D''être une tête brûlée", "en": "Being a daredevil"}'),
  (154, 15, 4, '{"fr": "De ne jamais lâcher l''affaire", "en": "Never letting things go"}'),
  (161, 16, 1, '{"fr": "J''en ai une", "en": "I have one"}'),
  (162, 16, 2, '{"fr": "Passager·e avec plaisir", "en": "Happy to ride pillion"}'),
  (163, 16, 3, '{"fr": "J''aimerais essayer", "en": "I''d love to try"}'),
  (164, 16, 4, '{"fr": "Pas pour moi", "en": "Not for me"}'),
  (171, 17, 1, '{"fr": "J''y poste ma vie", "en": "I post my whole life"}'),
  (172, 17, 2, '{"fr": "Je regarde sans poster", "en": "I watch without posting"}'),
  (173, 17, 3, '{"fr": "Le strict minimum", "en": "The bare minimum"}'),
  (174, 17, 4, '{"fr": "Je n''en ai pas", "en": "I''m not on them"}'),
  (181, 18, 1, '{"fr": "Un verre dans un bar", "en": "A drink in a bar"}'),
  (182, 18, 2, '{"fr": "Une activité (billard, karting, bowling)", "en": "An activity (pool, karting, bowling)"}'),
  (183, 18, 3, '{"fr": "Une balade", "en": "A walk"}'),
  (184, 18, 4, '{"fr": "Direct un concert", "en": "Straight to a gig"}'),
  (191, 19, 1, '{"fr": "J''en ai", "en": "I have some"}'),
  (192, 19, 2, '{"fr": "J''adore, mais pas chez moi", "en": "I love them, but not at home"}'),
  (193, 19, 3, '{"fr": "Pas fan", "en": "Not a fan"}'),
  (194, 19, 4, '{"fr": "Indifférent·e", "en": "Indifferent"}'),
  (201, 20, 1, '{"fr": "« Tant mieux. »", "en": "\"Good.\""}'),
  (202, 20, 2, '{"fr": "Je montre mon côté tendre", "en": "I show my soft side"}'),
  (203, 20, 3, '{"fr": "Je passe à autre chose", "en": "I move on"}'),
  (204, 20, 4, '{"fr": "J''éclate de rire", "en": "I burst out laughing"}');
