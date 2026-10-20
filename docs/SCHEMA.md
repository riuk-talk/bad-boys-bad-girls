# Schéma de base — v2 (concept v2, en attente de validation)

> **v1** validée en Phase 0 (corrections `docs/PHASE0-DECISIONS.md` §B) et livrée en Phase 2 (migrations `supabase/migrations/2026100219*`).
> **v2** (2026-10-03) : intègre `docs/CONCEPT-V2.md` / SPEC v7 — rôles Bad/Visiteur, demandes de parloir, heures de visite, visites, Web Push, Promenade, seuils « les Bads d'abord ». **Validée** (`docs/CONCEPT-V2-DECISIONS.md`, dont la règle 14 : pari secret pour les deux jusqu'à la visite). Migration en Phase 2b (§6).
> Marqueurs : **[v2-modif]** = change une table ou une fonction **déjà en base** (migration de modification) ; **[v2-nouveau]** = nouvel objet ; **[v2-supprimé]** = objet prévu en v1, abandonné (jamais créé en base, sauf mention).
> Postgres 17 (Supabase). Tous les horodatages en `timestamptz` (UTC). Renvois **(Rxx)** → [`PHASE0.md`](./PHASE0.md), **(Bx)** → [`PHASE0-DECISIONS.md`](./PHASE0-DECISIONS.md).

## 0. Principes transverses

- **RLS activée sur toutes les tables, refus par défaut.** Une table sans politique n'est lisible par personne (hors clé secrète et fonctions `security definer`).
- **Les autres membres ne lisent jamais les tables directement.** Une Fiche ou un Permis vu par un tiers passe toujours par une fonction `security definer` (`get_fiche`, `get_permit`, `discover_bads`, `get_my_promenade`…) qui applique rôle, visibilité, blocages, réciprocité, et ne renvoie que des champs publics (âge calculé, jamais la date de naissance ; jamais l'index du vrai du Casier).
- **Cloisonnement par rôle** [v2] : un Visiteur ne lit que des Bads ; un Bad ne lit que les Visiteurs qui lui ont envoyé une demande ; deux Visiteurs ou deux Bads ne se voient jamais.
- **Toutes les écritures sensibles passent par des fonctions SQL** (`send_visit_request`, `decide_visit_request`, `choose_slot`, `send_message`…) ; les tables concernées n'ont **aucune** politique `insert/update/delete` pour `authenticated`.
- Fonctions `security definer` : `set search_path = ''`, noms entièrement qualifiés, `revoke execute … from public, anon` puis `grant execute … to authenticated` uniquement pour celles appelables par l'UI. Les fonctions internes (jobs) ne sont exécutables que par `postgres`.
- Extensions : `citext`, `pg_trgm`, `unaccent`, `cube` + `earthdistance`, `pg_cron`, `pg_net`, `pgtap`, `supabase_vault` ; **[v2-nouveau] `btree_gist`** (contraintes d'exclusion : pas de chevauchement de visites).
- `is_seed boolean` sur les tables de contenu membre : exclusion de toutes les statistiques ; insertion impossible si `app.env = 'production'`.
- Toutes les colonnes filtrées/triées sont indexées (listées par table).

## 1. Types énumérés

| Type | Valeurs | État |
|---|---|---|
| `gender` | `man`, `woman`, `non_binary`, `other` | en base |
| `member_role` | `bad`, `visitor` | **[v2-nouveau]** |
| `moderation_status` | `pending`, `approved`, `rejected` | en base |
| `zone_status` | `waitlist`, `open` | en base |
| `launch_mode` | `zones`, `open` | en base |
| `importance` | `low` (1), `important` (10), `essential` (50) | **en base (Phase 3a)** ; poids via `importance_weight()` |
| `question_phase` | `core` (10 à l'inscription), `extra` | Phase 3 |
| `visit_request_status` | `pending`, `accepted`, `released`, `dismissed`, `auto_dismissed`, `cancelled`, `closed` | **[v2-nouveau]**, remplace `plea_status` |
| `case_close_reason` | `dismissed_by_bad`, `no_answer_7d`, `no_slot_chosen`, `no_new_slots`, `second_no_show`, `second_cancellation` (5b), `closed_after_absence` (5c), `not_prolonged`, `no_end_choice`, `closed_after_release`, `cancelled_by_visitor`, `role_change`, `blocked`, `account_deleted`, `banned` | **[v2-nouveau]** (sert aussi aux métriques) |
| `slot_status` | `offered`, `chosen`, `expired`, `withdrawn` | **[v2-nouveau]** |
| `visit_status` | `scheduled`, `in_progress`, `ended`, `no_show`, `cancelled` | **[v2-nouveau]** |
| `visit_absence` | `bad`, `visitor`, `both` | **[v2-nouveau]** |
| `visit_end_choice` | `prolong`, `close` | **[v2-nouveau]** |
| `conversation_status` | `visiting` (messages permis seulement pendant une visite en cours), `open` (Permis permanent), `closed` | **[v2-modif]** (ajout de `visiting`) |
| `message_kind` | `text`, `system` | **[v2-nouveau]** |
| `close_reason` | `dismissed`, `blocked`, `account_deleted`, `banned` | Phase 6 |
| `venue_type` | `bar`, `cafe`, `concert`, `walk`, `activity` | Phase 6 |
| `date_proposal_status` | `pending`, `accepted`, `countered`, `not_yet`, `cancelled` | en base (Phase 6b) |
| `report_target` | `profile`, `permit`, `photo`, `casier`, `message`, `visit_request` | **[v2-modif]** (`plea` → `visit_request`, + `permit`) |
| `report_category` | `fake_profile`, `minor`, `harassment`, `sexual_content`, `violence_threat`, `scam`, `other` | en base |
| `report_status` | `open`, `upheld`, `rejected` | en base |
| `moderation_action_type` | `warn`, `suspend`, `ban`, `unban`, `hide_profile`, `unhide_profile`, `photo_approve`, `photo_reject`, `text_clear`, `text_remove`, `revoke_good_conduct` | **[v2-modif]** (`revoke_reglo` renommé ; type pas encore en base) |
| `consent_type` | `terms`, `privacy`, `age_18`, `art9_seeking` | en base |
| `notification_type` | `request_received`, `request_accepted` (créneaux proposés), `request_dismissed`, `slot_chosen`, `slots_declined`, `slots_reproposed`, `visit_cancelled`, `visit_reminder_1h`, `visit_starting`, `visit_no_show`, `visit_released`, `visit_closed`, `message_received`, `date_proposed`, `date_accepted`, `date_countered`, `promenade_open`, `permit_granted`, `moderation_decision`, `zone_opened`, `profile_dormant` | **[v2-modif]** (type pas encore en base) |
| `email_kind` | `request_digest`, `visit_reminder`, `permit_granted`, `date_accepted`, `zone_opened`, `profile_dormant`, `weekly_digest`, `moderation_decision`, `onboarding_reminder`, `admin_photos_pending`, `admin_zone_ready` | **[v2-modif]** en base : `plea_digest` → `request_digest` ; + `visit_reminder`, `permit_granted`, `admin_zone_ready` |
| `flag_source` | `pseudo`, `bio`, `visit_motive`, `casier`, `tribe_detail`, `visit_request`, `message`, `date_venue` | **[v2-modif]** en base : `plea` → `visit_request` ; + `visit_motive` |

`plea_status` **[v2-supprimé]** (jamais créé).

## 2. Tables

Notation RLS : **S** select, **I** insert, **U** update, **D** delete. « — » = aucune politique (donc refusé).

### 2.1 Référentiels

#### `places` — communes (seed officiel, R22) — inchangé
| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `bigint` identity | PK |
| `country_code` | `char(2)` | not null, défaut `'FR'` |
| `official_code` | `text` | code INSEE ; unique (`country_code`, `official_code`) |
| `name` | `text` | not null |
| `name_search` | `text` | généré : `lower(unaccent(name))` |
| `postal_codes` | `text[]` | |
| `lat`, `lng` | `double precision` | not null |
| `population` | `integer` | |

Index : GIN trigramme sur `name_search`, GIST `ll_to_earth(lat,lng)`. RLS : **S** `authenticated` ; I/U/D —.

#### `launch_zones` — le Quartier — **[v2-modif]**
| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `smallint` identity | PK |
| `slug` | `text` | unique |
| `name` | `text` | not null |
| `center_place_id` | `bigint` → `places` | not null |
| `radius_km` | `smallint` | check 5–200 |
| `timezone` | `text` | not null, défaut `'Europe/Paris'` |
| `status` | `zone_status` | défaut `waitlist` |
| ~~`threshold_profiles`~~ | | **supprimée** (était 150 Fiches) |
| `threshold_bads` | `integer` | **[v2]** défaut **50**, check > 0 |
| `threshold_women_pct` | `smallint` | défaut 40, check 0–100 — plancher de bad girls = `ceil(threshold_bads × pct / 100)` |
| `threshold_men_pct` | `smallint` | **[v2]** défaut 20, check 0–100 — plancher de bad boys (0 = désactivé) |
| `auto_open` | `boolean` | défaut false |
| `ready_at` | `timestamptz` | **[v2]** première fois où les seuils sont atteints (prévient l'admin une seule fois) |
| `opened_at` | `timestamptz` | |

RLS : **S** `authenticated` ; écriture via fonctions admin. (B1) `admin_upsert_zone` recalcule `profiles.zone_id` des membres concernés.

#### `app_settings` — ligne unique — **[v2-modif]**
`launch_mode`, `ban_hash_retention_months` (12), `email_daily_quota` (300), `email_auth_reserve` (100), **`promenade_max_appearances_per_day`** (10, renommée depuis `hearing_max_appearances_per_day`), **`zone_bad_active_days`** (30, **[v2]** : un Bad compte pour le seuil s'il s'est connecté dans ce délai), `storage_alert_mb` (700), `egress_alert_gb` (3,5), `updated_at`.

#### `egress_readings` — inchangé (Phase 7)
`month date PK`, `egress_gb numeric(6,2)`, `entered_by`, `created_at`. RLS : —.

#### `tribes`, `moderation_keywords` — inchangés

#### `questions` / `question_options` — **en base (Phase 3a)**
`questions` : `id smallint PK` (= numéro SPEC §9), `position` unique, `phase` (`core` 1–10, `extra` 11–20), `label jsonb {fr,en}`, `is_active`. `question_options` : `id smallint PK` = **id de question × 10 + position** (11–14, …, 201–204), unique (`question_id`, `position`) et (`question_id`, `id`). Seed des 20 questions dans la migration (anglais : `docs/content/questions-en.md`, à relire). RLS **S** `authenticated` sur les questions actives et leurs options ; aucune écriture membre.
(voir v1 : libellés `{fr,en}`, RLS **S** `authenticated` pour les référentiels, — pour `moderation_keywords`.)

### 2.2 Comptes, Fiche et Permis

#### `profiles` — Fiche du Bad / Permis du Visiteur (1–1 avec `auth.users`) — **[v2-modif]**
| Colonne | Type | Contraintes / remarque |
|---|---|---|
| `id` | `uuid` | PK, → `auth.users(id) on delete cascade` |
| `role` | `member_role` | **[v2]** null jusqu'à l'étape 3 ; obligatoire pour terminer l'onboarding — **protégé** (écrit par `set_onboarding_role()` puis `change_role()`) |
| `role_changed_at` | `timestamptz` | **[v2]** dernier changement après l'onboarding (règle des 7 jours) — **protégé** |
| `ecrou` | `char(6)` | **en base (Phase 4a)** — N° d'écrou : 6 chiffres aléatoires, unique (index partiel), donné par le trigger quand le rôle devient `bad`, jamais choisi ni modifié (même par le propriétaire de la base), conservé si le rôle change ; jamais dérivé de `id` ; aucune fonction ne le prend en entrée ; affiché seulement par `get_fiche()` — **protégé** |
| `pseudo` | `citext` | unique, 3–20 ; refus e-mails/téléphones/liens |
| `birthdate` | `date` | trigger âge ≥ 18 ; via `set_birthdate()` seulement |
| `gender` | `gender` | |
| `seeking_genders` | `gender[]` | non vide si onboarding terminé |
| `seek_age_min`, `seek_age_max` | `smallint` | 18 ≤ min ≤ max ≤ 99 |
| `place_id` | `bigint` → `places` | |
| `lat`, `lng` | `double precision` | copiés depuis `places` (centre de commune) |
| `zone_id` | `smallint` → `launch_zones` | calculé par trigger |
| `bio` | `varchar(500)` | présentation du Bad, facultative ; masquage + mots-clés |
| `visit_motive` | `varchar(280)` | **[v2]** Motif de visite du Visiteur, obligatoire pour terminer l'onboarding d'un Visiteur et pour passer Bad → Visiteur ; masquage + mots-clés (`flag_source = visit_motive`) |
| `onboarding_step` | `smallint` | **[Phase 3]** 0–8 (était 0–7) : 8 étapes pour les deux rôles (SPEC §4) |
| `onboarding_completed_at` | `timestamptz` | |
| `moderation_status` | `moderation_status` | **protégé** |
| `is_reglo` | `boolean` | badge **Bonne conduite** (nom technique conservé, CONCEPT-V2 §7) — **protégé** |
| `hidden_reason`, `suspended_until`, `banned_at` | | **protégés** |
| `is_paused` | `boolean` | modifiable (Bad) |
| `paused_at` | `timestamptz` | trigger — **protégé** |
| `requests_cap` | `smallint` | **[v2-modif]** renommée depuis `pleas_cap` ; défaut 15, 5–50 |
| `requests_closed_manual` | `boolean` | **[v2-modif]** depuis `pleas_closed_manual` |
| `pending_requests_count` | `integer` | **[v2-modif]** depuis `pending_pleas_count` — **protégé** |
| `requests_open` | `boolean` | **[v2-modif]** depuis `pleas_open` : `not requests_closed_manual and pending_requests_count < requests_cap` — **protégé** |
| `last_seen_at`, `dormant_since`, `casier_updated_at` | | **protégés** |
| `referral_code`, `referred_by` | | **protégés** |
| `consecutive_dismissals` | `smallint` | conseils au Visiteur après 3 classements — **protégé** |
| `is_seed` | `boolean` | **protégé** |
| `created_at`, `updated_at` | | |

Check de fin d'onboarding **[v2-modif]** : en plus de v1, `role is not null` et (`role <> 'visitor' or visit_motive is not null`). Le Casier (Bad) et les réponses à toutes les questions `core` actives sont vérifiés par `complete_onboarding()` (Phase 3a), qui passe `onboarding_step` à 8.
Index **[v2-modif]** : `profiles_discovery` devient (`zone_id`, `role`, `moderation_status`, `is_paused`) partiel `where onboarding_completed_at is not null and banned_at is null and hidden_reason is null` ; + v1 (`last_seen_at desc`, GIST, `referred_by`, `place_id`).
RLS : **S** propriétaire ; **I** propriétaire ; **U** propriétaire avec privilèges de colonnes : `grant update (pseudo, gender, seeking_genders, seek_age_min, seek_age_max, place_id, bio, visit_motive, is_paused, requests_cap, requests_closed_manual, onboarding_step)` ; `role` **n'en fait pas partie** ; **D** —.

#### `profile_tribes` — inchangé
5 maximum ; précision 60 caractères masquée. RLS propriétaire ; les autres via `get_fiche` / `get_permit`.

#### `photos` — **[v2-modif léger]**
Inchangée en structure. **Positions (v7.4, PARCOURS-DESIGN §3)** : `0` = face (photo d'identité), `1` = profil gauche, `2` = profil droit, `3`–`5` = photos supplémentaires. Un Bad doit avoir les positions 0, 1 et 2 pour terminer l'onboarding (`has_three_poses()`), et les 3 validées pour être compté ou visible. Règle v2 : pour un Visiteur, seule la photo `position = 0` est renvoyée par `get_permit` ; les autres restent stockées (ex-Bad) et réapparaissent s'il redevient Bad. Le Visiteur ne peut pas ajouter de photo au-delà de la position 0 (trigger).
Priorité de la file du Greffe (`admin_photo_queue`) : photo 0 des Visiteurs d'un quartier ouvert, puis photo 0 des Bads, puis le reste, par ancienneté.

#### `casier_charges` — le Casier — **en base (Phase 3a)**
| Colonne | Type | Contraintes |
|---|---|---|
| `profile_id` | `uuid` | PK → `profiles on delete cascade` |
| `charge_1`, `charge_2`, `charge_3` | `varchar(120)` | not null, masquage |
| `true_index` | `smallint` | **[v2]** check 1–3, remplace `false_index` (1 vrai, 2 faux) |
| `updated_at` | `timestamptz` | |

Trigger : coordonnées masquées (`mask_contacts`), **trois lignes différentes** (`charge_key()` : casse et espaces ignorés, sinon `casier_duplicate_charges`), mots-clés signalés, `casier_updated_at`.
RLS : **S/I/U** propriétaire **et** `role = 'bad'` pour I/U (un Visiteur ne crée pas de Casier ; un ex-Bad garde le sien en lecture) ; **D** —. Les Visiteurs voient les 3 lignes via `get_fiche` **sans** `true_index`.

#### `answers` — **en base (Phase 3a)**
Comme en v1 ; l'option doit appartenir à la question (clé étrangère composée vers `question_options (question_id, id)`). Trigger : question active obligatoire ; `accepted_option_ids` dédoublonné, trié, non vide, options de la même question ; « toutes les options » enregistré `null`. Droits : **I** (`user_id`, `question_id`, `option_id`, `accepted_option_ids`, `importance`), **U** (`option_id`, `accepted_option_ids`, `importance`), **S/D** ; une seule politique propriétaire `for all`.

#### `consents`, `admin_users`, `banned_email_hashes` — inchangés
(voir v1 ; `banned_email_hashes` contrôlée par le hook « Before User Created », vérifié en Phase 2 pour le lien magique et le mot de passe.)

### 2.3 Interactions

#### `blocks` — **en base (Phase 4a)**
`blocker_id`, `blocked_id`, `created_at`, `unblocked_at` (PK couple) : un blocage n'est jamais supprimé, `unblock_user()` remplit `unblocked_at` (historique gardé, aucun `DELETE`). RLS : **S** propres lignes (liste « Bloqués ») ; **I/U** via `block_user()` / `unblock_user()` seulement.
`block_user()` **[v2-modif]** : annule les demandes en cours, annule les visites programmées (`cancelled`, sans pénalité pour le bloqueur), ferme la conversation (`blocked`), le tout atomiquement.

#### `visit_requests` — la Demande de parloir — **en base (Phase 4a)** (remplace `pleas`)
| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `visitor_id` | `uuid` → `profiles on delete cascade` | rôle `visitor` à l'envoi |
| `bad_id` | `uuid` → `profiles on delete cascade` | rôle `bad` à l'envoi ; check `visitor_id <> bad_id` |
| `guessed_index` | `smallint` | 1–3, chef parié **vrai** |
| `casier_snapshot` | `jsonb` | `{charges:[…3], true_index}` copié à l'envoi |
| `guess_correct` | `boolean` | calculé à l'envoi ; **jamais renvoyé au Visiteur avant le début de la première visite** |
| `note` | `varchar(280)` | mot facultatif, masqué |
| `note_normalized` | `text` | anti-arnaque |
| `status` | `visit_request_status` | défaut `pending` |
| `close_reason` | `case_close_reason` | rempli quand le statut devient final |
| `slots_round` | `smallint` | 0 avant acceptation ; 1 = première proposition ; +1 à chaque nouvelle proposition |
| `slots_declined` | `boolean` | « Aucun ne me va » déjà utilisé |
| `choose_deadline` | `timestamptz` | proposition + 48 h (le Visiteur choisit) |
| `repropose_deadline` | `timestamptz` | + 48 h (le Bad repropose après « Aucun ne me va » ou absence) |
| `no_show_count` | `smallint` | absences dans ce couple ; 2 → classement |
| `conversation_id` | `uuid` → `conversations` | créée au premier créneau choisi (colonne sans clé étrangère jusqu'à la Phase 5) |
| `created_at`, `decided_at`, `closed_at` | `timestamptz` | |

Index : unique partiel (`visitor_id`, `bad_id`) `where status in ('pending','accepted')` (1 en cours par couple) ; (`bad_id`, `status`, `created_at`) (« Le Courrier ») ; (`visitor_id`, `created_at desc`) (5/24 h + anti-arnaque 7 j) ; (`status`, `created_at`) partiel `pending` (expiration 7 j) ; (`choose_deadline`) partiel et (`repropose_deadline`) partiel (tâche minute) ; (`visitor_id`, `bad_id`, `closed_at desc`) (délai de 30 j).
RLS : **S** — ; **I/U/D** —. **Règle 14** : avant `visits.status = 'in_progress'` pour ce couple, **aucune** fonction ne renvoie `guess_correct` ni `true_index` (à personne), et `get_mailbox()` (Bad) ne renvoie ni `guessed_index` ni le texte du chef choisi. `get_my_requests()` (Visiteur) ne renvoie **ni le chef qu'il a choisi ni le résultat** (décision du porteur, 2026-10-05 : aucune fonction ne renvoie `true_index`, le chef choisi, la copie du Casier ou le résultat du pari, au Bad, au Visiteur ou à un tiers ; prouvé par `phase4_relations.test.sql`). Chef choisi et résultat sont révélés ensemble par le message système inséré par `run_visit_ticks` au début de la visite.

#### `visit_slots` — les Heures de visite — **[v2-nouveau]**
| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `request_id` | `uuid` → `visit_requests on delete cascade` | |
| `round` | `smallint` | tour de proposition |
| `starts_at` | `timestamptz` | ≥ proposition + 2 h et ≤ proposition + 7 j (contrôlé dans la fonction, pas en `CHECK`, B5) |
| `ends_at` | `timestamptz` | `starts_at + 30 min` (écrit par la fonction ; check `ends_at = starts_at + interval '30 minutes'`) |
| `status` | `slot_status` | défaut `offered` |
| `created_at` | `timestamptz` | |

Contraintes : 2 ou 3 créneaux par (`request_id`, `round`) (contrôlé dans `decide_visit_request` / `propose_slots`) ; pas de chevauchement entre les créneaux d'un même tour.
Index : (`request_id`, `round`).
RLS : **S** — (via `get_request_schedule()`) ; **I/U/D** —. Phase 5b : 2 ou 3 créneaux et absence de doublon contrôlés dans `checked_slots` (appelée par `accept_visit_request` / `propose_slots`) ; chevauchement entre créneaux d'un même tour impossible (créneaux de 30 min alignés sur :00/:30 et distincts).

#### `visits` — la visite au Parloir — **[v2-nouveau]**
| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `request_id` | `uuid` → `visit_requests on delete cascade` | |
| `slot_id` | `uuid` → `visit_slots` | |
| `bad_id`, `visitor_id` | `uuid` → `profiles on delete cascade` | dénormalisés pour les contraintes d'exclusion |
| `conversation_id` | `uuid` → `conversations` | |
| `starts_at`, `ends_at` | `timestamptz` | copiés du créneau |
| `status` | `visit_status` | défaut `scheduled` |
| `bad_joined_at`, `visitor_joined_at` | `timestamptz` | présence (`join_visit()`, horloge de la base) |
| `absent` | `visit_absence` | rempli à `starts_at + 10 min` si quelqu'un manque |
| `cancelled_by` | `uuid` | |
| `cancelled_late` | `boolean` | annulation < 2 h avant le début → compte comme absence de `cancelled_by` |
| `bad_end_choice`, `visitor_end_choice` | `visit_end_choice` | |
| `end_choice_deadline` | `timestamptz` | `ends_at + 24 h` |
| `outcome` | `text` check in (`released`, `closed`) | **`released` = Permis permanent** (nom technique conservé) |
| `reminder_sent_at`, `start_notified_at` | `timestamptz` | idempotence des rappels |
| `created_at` | `timestamptz` | |

Contraintes **(btree_gist)** :
- `exclude using gist (bad_id with =, tstzrange(starts_at, ends_at) with &&) where (status in ('scheduled','in_progress'))` — un Bad n'a jamais deux visites qui se chevauchent ;
- même contrainte sur `visitor_id` ;
- unique partiel (`request_id`) `where status in ('scheduled','in_progress')` — une seule visite programmée par couple.

Phase 5b (`20261007184105_phase5b_visiting_hours`) : créées sans `conversation_id`, `bad_joined_at`, `visitor_joined_at`, `absent`, choix de fin, `outcome` (ajoutés en 5c) ; en plus `cancelled_at`. RLS activée **sans aucune lecture directe** pour l'instant (lecture par `get_my_visits()` / `get_request_schedule()`) ; la lecture participant pour le temps réel sera décidée en 5c.
Index : (`status`, `starts_at`) partiel `scheduled`/`in_progress` (tâche minute) ; (`bad_id`, `starts_at`), (`visitor_id`, `starts_at`) (agendas, Visites honorées) ; (`status`, `end_choice_deadline`) partiel `ended` et `outcome is null`.
RLS : **S** participant (`auth.uid() in (bad_id, visitor_id)`) et pas de blocage — nécessaire pour l'abonnement temps réel à l'état de la visite (écran d'attente) ; ne contient aucune donnée cachée à l'autre (les choix de fin sont lus via `get_visit()`, qui ne révèle jamais le choix de l'autre) → **[à trancher en Phase 5]** : si l'on veut cacher les choix de fin même aux participants, la lecture passe uniquement par `get_visit()` et l'écran d'attente interroge la fonction toutes les 5 s. **I/U/D** —.

#### `conversations` — **[v2-modif]** (en base, Phase 5c `20261018104313_phase5c_parloir`)
Comme v1, avec : `origin_request_id uuid` (remplace `origin_plea_id`), `status conversation_status` (`visiting` à la création au premier créneau choisi → `open` à la Permis permanent → `closed`), `released_at timestamptz`.
Index unique partiel (`least`, `greatest`) des deux membres `where status in ('visiting','open')`.
RLS : **S** membre ; **I/U/D** —.

#### `messages` — **[v2-modif]** (en base, Phase 5c)
Comme v1, avec :
- `kind message_kind` défaut `text` ; `system_payload jsonb` (pour le message « résultat du pari » et les messages neutres) ; `visit_id uuid` → `visits` (message envoyé pendant une visite) ;
- check : (`kind = 'system'` ⇒ `sender_id is null and system_payload is not null`) ; (`kind = 'text'` ⇒ `body is not null or sender_deleted`).
- `send_message` n'accepte un message dans une conversation `visiting` que si une visite de ce couple est `in_progress`, que `now() < ends_at` et que l'expéditeur est présent ; masquage des coordonnées **toujours actif** pendant une visite.
Realtime : Postgres Changes sur `messages` (filtre `conversation_id`), ouvert uniquement sur l'écran affiché ; repli par interrogation toutes les 3 s si la connexion est refusée (plafond de connexions de l'offre gratuite, **à vérifier**).

Phase 5c, écarts : `conversations` (`request_id` unique, `bad_id`, `visitor_id`, `status`, `released_at`, `closed_at`, `last_message_at`) créée au **début** de la visite, aucune lecture directe (fonctions `get_conversation`, `get_my_parloirs`) ; `messages.body varchar(1100)` (le jeton de masquage peut allonger un message de 1 000 caractères), payloads système `bet` / `note` / `released` / `closed`, lecture directe **autorisée aux deux membres** (politique `private.can_read_conversation`, nécessaire à Realtime) et publication `supabase_realtime`. `visits` : présence, `absent`, choix de fin, `end_choice_deadline`, `outcome` ajoutés ; toujours aucune lecture directe (choix cachés : `get_visit` interrogée toutes les 5 s, décision 2026-10-06). Fonctions : `join_visit`, `get_visit`, `choose_visit_end`, `send_message`, `get_messages`, `get_conversation`, `get_my_parloirs`, `close_conversation` ; internes `start_visit`, `reveal_bet`, `resolve_visit`, `run_parloir_ticks` (pg_cron `parloir-ticks` chaque minute, à côté de `visit-schedule` de la 5b ; pas de `run_visit_ticks` unique). Pas de `request_reschedule` : le report s'ouvre automatiquement après une absence.

#### `date_proposals` — la Cavale — **en base (Phase 6b `20261019110000_phase6b_cavale`)**
`id uuid PK`, `conversation_id → conversations on delete cascade`, `proposer_id → profiles on delete set null`, `venue_type venue_type` (`bar`, `cafe`, `concert`, `walk`, `activity`), `venue_name varchar(200)` (120 saisis, masqués), `starts_at`, `status date_proposal_status` (`pending`, `accepted`, `countered`, `not_yet`, `cancelled`), `parent_id → date_proposals` (autre proposition), `private_place_warning`, `responded_at`, `cancelled_by`, `cancelled_at`, `created_at`.
Index : unique partiel (`conversation_id`) `where status = 'pending'` ; (`conversation_id`, `created_at desc`) ; clés étrangères indexées.
RLS : activée, **aucun droit direct** (lecture par `get_dates`, écriture par `propose_date`, `counter_date`, `respond_date`, `cancel_date`). Internes : `insert_date_proposal`, `open_conversation_for`, `date_is_upcoming` (jour en heure de France), `looks_private_place`.
`conversations` (Phase 6) : `bad_read_id`, `visitor_read_id` (6a, `mark_conversation_read`, `get_read_state`, `get_unread_counts`), `cavale_accepted_at` (6b, première Cavale acceptée ; lue par `private.can_unmask`, 6c).

#### `promenade_picks` — la Promenade — **en base (Phase 4a)** (remplace `daily_hearings`, jamais créée)
`id bigint identity PK`, `visitor_id → profiles on delete cascade`, `bad_id → profiles on delete cascade`, `zone_id`, `promenade_date date` (date locale), `rank smallint` (1–5), `score smallint`, `visible_from`, `visible_until`, `seen_at`.
Contraintes : unique (`visitor_id`, `promenade_date`, `bad_id`), unique (`visitor_id`, `promenade_date`, `rank`).
Index : (`visitor_id`, `visible_from desc`) ; (`bad_id`, `promenade_date`) (exclusion 14 j + plafond d'apparitions) ; (`zone_id`, `promenade_date`) (tâche horaire).
RLS : **S** — (via `get_my_promenade()`) ; **U** — (`mark_promenade_seen()`).

#### `reports`, `moderation_actions`, `flagged_texts` — **en base (Phase 4a, `flagged_texts` depuis la 2b)**
`reports.target_type` accepte `permit` et `visit_request`. `report()` (Phase 4a, relecture) : signaleur avec inscription terminée ; cible visible pour lui, ou en relation (demande en cours ou passée), ou bloquée par lui, sinon `not_found`. Règle « mineur » : masquage immédiat après 2 signaleurs distincts **établis** (photo validée par le Greffe, compte de plus de 7 jours), ou 1 Bad « Bonne conduite ». `flagged_texts` est déjà en base.

### 2.4 Notifications, push, e-mails, activité

#### `notifications` — **en base (Phase 3)** (type `notification_type` v2)
Écrites uniquement par des fonctions SQL (le Greffe : `moderation_decision` par photo, `permit_granted` pour la face d'un Visiteur). RLS **S** propriétaire ; aucune écriture membre ; `mark_notifications_read()` (toutes, Greffe) et `mark_notifications_read(types[])` (Phase 4 : chaque écran ne marque lues que ses propres types ; la version sans argument n'est plus appelée par l'application).
`id`, `user_id`, `type`, `payload jsonb`, `read_at`, `created_at`. RLS : **S** propriétaire ; **U** via `mark_notifications_read()`.

#### `notification_preferences` — **[v2-modif]** (en base)
- renommée : `email_plea_digest` → **`email_request_digest`** ;
- ajouts : `email_visit_reminder boolean default false`, `email_permit_granted default true`, `push_requests default true`, `push_visits default true` (rappels, début, Permis permanent), `push_messages default true`, `push_promenade default true`, `push_prompt_declined_at timestamptz` (refus de la demande d'abonnement : pas de nouvelle demande avant 30 jours) ;
- inchangés : `email_date_accepted`, `email_zone_opened`, `email_dormant`, `email_weekly`, `unsubscribe_token`.
RLS : **S/U** propriétaire.

#### `push_subscriptions` — **[v2-nouveau]**
| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` → `profiles on delete cascade` | |
| `endpoint` | `text` | unique ; check `endpoint ~ '^https://'` |
| `p256dh`, `auth` | `text` | clés publiques du navigateur (pas des secrets de notre côté) |
| `created_at`, `last_success_at` | `timestamptz` | |
| `failure_count` | `smallint` | abonnement supprimé après réponse 404/410 du service de push, ou 5 échecs |

Pas d'agent utilisateur, pas d'IP (minimisation). 5 abonnements maximum par membre (trigger : le plus ancien est supprimé).
Index : (`user_id`).
RLS : **S/D** propriétaire ; **I/U** — (via `save_push_subscription()` ; envoi par la route serveur avec la clé secrète).

#### `push_outbox` — **[v2-nouveau]**
`id bigint identity PK`, `user_id → profiles on delete cascade`, `type notification_type`, `payload jsonb` (**texte neutre + URL interne uniquement** : pas de pseudo, pas de photo, pas de message), `not_before timestamptz`, `status text check in ('queued','sent','failed','skipped')`, `attempts`, `sent_at`, `created_at`. Unique partiel (`user_id`, `type`, `dedupe_key`) pour l'idempotence des rappels.
Index : (`status`, `not_before`).
RLS : — (route `/api/cron/push` avec la clé secrète).

#### `email_outbox` — **[v2-modif]** (en base)
Index unique « un par jour » : `kind in ('request_digest', 'admin_photos_pending')`. `visit_reminder` : abandonné (`skipped`) si le quota du jour est atteint ou si la visite a commencé.

#### `email_quota_usage`, `web_vitals_daily`, `activity_days` — inchangés.

## 3. Fonctions SQL

### 3.1 Utilitaires (internes ou `stable`)
| Fonction | Rôle | État |
|---|---|---|
| `is_admin()`, `age_years(date)`, `normalize_text(text)`, `mask_contacts(text)`, `flag_keywords(...)`, `zone_for(...)` | inchangés | en base |
| `is_blocked_between(a, b)` | blocage dans un sens ou l'autre | Phase 4 |
| `is_member_active(p)` | onboarding terminé, non banni, non suspendu, non masqué | **[v2]** (remplace `is_profile_active`) |
| `has_permit(p)` | Visiteur actif dont la photo 0 est validée | **[v2-nouveau]** |
| `is_bad_visible(p)` | Bad actif, photo 0 validée, Casier présent, non en pause, connecté < 90 j, quartier ouvert (sauf `launch_mode = open`) | **[v2-nouveau]** |
| `counts_for_zone(p)` | Bad compté pour le seuil (SPEC §3) : `is_bad_visible` sans la condition de quartier ouvert, connecté < `zone_bad_active_days`, `is_seed = false`, **3 poses validées** (Phase 3) | **[v2-nouveau]** (remplace `is_complete_fiche`, en base) |
| `criteria_match(a, b)` | genre et âge, **dans les deux sens** | Phase 4 |
| `can_view_bad(viewer, bad)` | `viewer` Visiteur actif dans un quartier ouvert, `is_bad_visible(bad)`, `criteria_match`, pas de blocage | **[v2]** (remplace `can_view_profile`) |
| `has_open_relation(a, b)` | demande en cours, visite programmée ou conversation `visiting`/`open` entre les deux (B2) | **[v2-modif]** |
| `visitor_reputation(v)` → `(casier_vierge bool, honored int, due int)` | SPEC §5 bis | **[v2-nouveau]** |
| `can_unmask(conversation)` | conversation `open` (Permis permanent) **et** une Cavale acceptée (même annulée ensuite) **et** comptes > 7 j **et** aucun signalement ouvert bloquant (B3) ; s'applique aux messages envoyés après la levée | **[v2-modif]** (v7.6 : voie « 10/10 messages » retirée, 2026-10-19) |
| `pair_cooldown_until(visitor, bad)` | fin du délai de 30 jours après un classement (sens Visiteur → Bad) | **[v2-modif]** |
| `slot_shortcuts(zone)` | heures locales de « Ce soir », « Demain soir », « Ce week-end » (SPEC §7 bis) | **[v2-nouveau]** (miroir TS pour l'UI, tests de parité) |
| `touch_activity()` | inchangé | Phase 4 |

### 3.2 Appelables par l'UI (`security definer`, `authenticated`)
| Fonction | Rôle | État |
|---|---|---|
| `set_birthdate(date)` | inchangé | en base |
| `set_onboarding_role(role)` | étape 3, uniquement avant la fin de l'onboarding | **[v2-nouveau]** |
| `complete_onboarding()` | commun : date, identité, rôle, recherche, 4 consentements, photo 0, 10 réponses `core` ; **Bad** : Casier ; **Visiteur** : `visit_motive` | **[v2-modif]** (en base, 4 étapes) |
| `change_role(new_role)` | 1 fois / 7 jours ; effets SPEC §2 bis (classe, annule, notifie) ; refusé vers Visiteur sans `visit_motive` | **[v2-nouveau]** |
| `complicity_score(a, b)` → `(score, common_count, capped)`, `common_points(a, b, n)` | **en base (Phase 3a), internes** : aucun droit `execute` pour `authenticated` ni `anon` (sinon un membre pourrait sonder les réponses d'un autre en variant les siennes). Appelées par `get_fiche`, `get_permit`, `get_mailbox` (Phase 4), qui contrôlent la visibilité. Arrondi au demi supérieur en entiers exacts ; miroir `lib/complicity.ts`, parité sur `tests/fixtures/complicity-cases.json` | **[Phase 3]** |
| `get_fiche(bad)` | autorisée si `can_view_bad` **ou** `has_open_relation` ; jamais en cas de blocage. Pseudo, âge, ville, photos validées, bio, signes, Casier sans le vrai, « Casier modifié depuis », indice + 3 points communs, Bonne conduite, `requests_open`, demande en cours ou délai | **[v2-modif]** |
| `get_permit(visitor)` | appelant = le Visiteur lui-même, ou un Bad ayant une relation ouverte ou passée avec lui ; photo 0, pseudo, âge, ville, Motif, signes, `visitor_reputation`, indice + points communs | **[v2-nouveau]** |
| `discover_bads(age_min, age_max, max_km, tribe_ids, good_conduct_only, recently_active, cursor, limit default 24)` | Visiteurs uniquement ; une seule requête, curseur `(sort_key, id)` ; conditions de `is_bad_visible` / `criteria_match` / blocages écrites dans la requête (Phase 4f : une fonction SQL avec `set search_path` n'est jamais inlinée), distance, ville et photo calculées pour la page seulement ; équivalence avec `can_view_bad` vérifiée par pgTAP | **[v2]** (remplace `discover_profiles`) |
| `get_my_promenade()`, `mark_promenade_seen(bad_id)` | Visiteurs uniquement | **[v2]** (remplacent `get_my_hearing`, `mark_hearing_seen`) |
| `send_visit_request(bad, guessed_index, note)` → `{request_id}` | voir 3.3 ; **ne renvoie pas** le résultat du pari | **[v2]** (remplace `send_plea`) |
| `decide_visit_request(request_id, accept)` | Bad uniquement ; **classer seulement** (accepter → erreur `slots_required`) ; message neutre | **[v2]** (remplace `decide_plea`) ; Phase 5b : signature de la Phase 4 gardée (pas de `DROP`) |
| `accept_visit_request(request_id, slots timestamptz[])` | Bad ; accepter = 2 ou 3 créneaux valides (`checked_slots`) ; aussi pour une demande acceptée en Phase 4 sans créneau | **[5b]** |
| `get_request_schedule(request_id)` → `jsonb` | participants ; tour, délais, créneaux (`available`), visite programmée, `can_propose` (Bad) ; rien sur le pari | **[5b]** |
| `run_visit_schedule()` | pg_cron chaque minute : classements à 48 h, rappels 1 h et début | **[5b]** |
| `propose_slots(request_id, slots timestamptz[])` | Bad ; après « Aucun ne me va » ou une annulation (48 h) — l'absence avec report viendra en 5c | **[v2-nouveau]** |
| `choose_slot(slot_id)` → `visit_id` | Visiteur ; avant `choose_deadline` et ≥ 15 min avant le début ; crée la visite (contraintes d'exclusion) ; la conversation `visiting` viendra en 5c | **[v2-nouveau]** |
| `decline_slots(request_id)` | Visiteur ; « Aucun ne me va », une fois par demande | **[v2-nouveau]** |
| `cancel_visit(visit_id)` | participant ; `cancelled_late` si < 2 h | **[v2-nouveau]** |
| `join_visit(visit_id)` | participant, pendant le créneau ; enregistre la présence ; au premier `join`, rien n'est révélé tant que la visite n'a pas commencé | **[v2-nouveau]** |
| `request_reschedule(visit_id)` | participant d'une visite `no_show` ; ouvre `repropose_deadline` côté Bad | **[v2-nouveau]** |
| `choose_visit_end(visit_id, prolong)` | participant, avant `end_choice_deadline` ; si les deux `prolong` → Permis permanent (`visit_requests.status = released`, conversation `open`) | **[v2-nouveau]** |
| `get_visit(visit_id)` | état, compte à rebours, présence de l'autre (oui/non), mon choix de fin (jamais celui de l'autre) | **[v2-nouveau]** |
| `get_my_requests()` | Visiteur : ses demandes, créneaux, statut (sans le résultat du pari avant la visite) | **[v2-nouveau]** |
| `get_mailbox()` | Bad : demandes reçues avec Permis, indice, 3 points communs, mot — **ni chef choisi ni résultat** (règle 14) | **[v2-nouveau]** |
| `get_my_visits()` | les deux rôles : agenda | **[v2-nouveau]** |
| `set_requests_settings(cap, closed_manual)` | Bad | **[v2]** (remplace `set_pleas_settings`) |
| `block_user(target)` / `unblock_user(target)` | voir 2.3 | **[v2-modif]** |
| `report(target_type, target_id, category, comment)` | masquage auto « mineur » si 2 signaleurs ou 1 Bad Bonne conduite | **[v2-modif]** |
| `send_message(conversation_id, body)` | voir `messages` | **[v2-modif]** |
| `get_my_blocks()` | Phase 4 : mes blocages actifs (pseudo, date), pour débloquer depuis Ma Fiche | |
| `mark_conversation_read`, `propose_date`, `respond_date`, `close_conversation`, `reorder_photos`, `referral_count`, `mark_notifications_read` | v1 ; `close_conversation` → `visit_requests.close_reason = closed_after_release` | |
| `get_counters()` | non-lus, demandes en attente (Bad), créneaux à choisir (Visiteur), prochaine visite, notifications | **[v2-modif]** |
| `zone_progress()` | `(zone_id, zone_name, status, launch_mode, bads, threshold_bads, bad_girls, min_bad_girls, bad_boys, min_bad_boys, visitors_waiting, ready)` | **[v2-modif]** (en base) |
| `save_push_subscription(endpoint, p256dh, auth)` / `delete_push_subscription(endpoint)` | | **[v2-nouveau]** |
| `export_my_data()` → `jsonb` | + demandes, visites, abonnements push (sans clés) | **[v2-modif]** |

`send_plea`, `decide_plea`, `set_pleas_settings`, `get_my_hearing`, `mark_hearing_seen`, `discover_profiles`, `can_view_profile`, `is_profile_active` : **[v2-supprimé]** (jamais créés).

### 3.3 `send_visit_request` — ordre des contrôles (une transaction, `for update` sur la ligne du Bad)
1. Expéditeur : rôle `visitor`, actif, `has_permit` (photo validée), quartier ouvert.
2. Destinataire : rôle `bad`, `can_view_bad(expéditeur, destinataire)` (visibilité, réciprocité, pas de blocage).
3. Délai de 30 jours (`pair_cooldown_until`) ; pas de demande en cours dans ce couple (index unique).
4. Limite : 5 demandes / 24 h glissantes ; 2 si le compte a moins de 24 h.
5. `requests_open` du Bad doit être vrai.
6. Insertion avec copie du Casier, calcul de `guess_correct` ; trigger qui incrémente `pending_requests_count` et recalcule `requests_open`.
7. Anti-arnaque : parmi les demandes **du même Visiteur** sur 7 jours, si ≥ 3 mots normalisés ont une similarité trigramme ≥ 0,9 → signalement automatique (n'empêche pas l'envoi).
8. Notification au Bad (in-app + push) + mise en file du récapitulatif e-mail du jour.

### 3.4 Admin (`security definer`, contrôle `is_admin()` en première ligne)
**En base (Phase 3)** : `admin_photo_queue(limit)` (une ligne par photo, priorité SPEC §11 : face des Visiteurs d'un quartier ouvert, puis les 3 poses des Bads, puis le reste) et `admin_decide_photo(photo, approve, reason, public_large, public_small)` (une décision par photo ; refus avec un motif de `photo_rejection_reasons()` ; publication sous un nom UUID aléatoire, jamais l'id du membre ; notifie le membre ; renvoie le fichier en attente à supprimer). Les fichiers sont copiés et supprimés par le serveur (clé secrète).
**En base (Phase 7a `20261019130100_phase7a_moderation`)** : `admin_report_queue(limit)` (signalements ouverts, « mineur » puis violence, harcèlement, arnaque, puis les plus anciens ; contenu signalé seul), `admin_decide_report(report, upheld, reason_reporter, action, reason_target, days)` (motif obligatoire pour le signaleur ; retenu = sanction `warn` / `suspend` / `ban` / `hide_profile` + motif pour la personne concernée ; masquage « mineur » levé quand tous les signalements « mineur » sont rejetés), `admin_flag_queue(limit)` / `admin_decide_flag(flag, 'clear' | 'uphold' | 'remove', reason)` (retrait possible pour bio, précision d'un signe, mot d'une demande — et sa copie au Parloir —, message), `admin_find_members(query)` (début du pseudo ou e-mail exact, jamais le N° d'écrou ni l'e-mail en sortie), `admin_member(user)`, `admin_sanction(user, action, reason, days)`, `admin_moderation_log(limit)`. Côté membre : `get_my_sanction()`, `get_my_decisions()` (mes signalements : issue et motif écrit pour moi ; décisions me concernant : motif, jamais le signaleur). Internes (`private`, non exécutables par les rôles de l'API) : `motive`, `member_state`, `close_cases_of`, `sanction_target`, `apply_sanction`, `removable_source`. Colonnes : `reports.decision_reason`, `moderation_actions.ends_at` / `flag_id`, `flagged_texts.decided_by` / `decided_at` / `decision_reason`, `messages.removed_at` ; types `notification_type` + `report_decided`, `sanction`, `case_close_reason` + `moderation`.
**En base (Phase 7b `20261020090000_phase7b_pilotage`)** : `admin_zones()` (avec la jauge, helper interne `private.zone_gauge`), `admin_save_zone(slug, name, center_place, radius_km, timezone, threshold_bads, women_pct, men_pct, auto_open, zone = null)` (planchers ≤ 100 % à deux, fuseau vérifié), `admin_set_zone_status(zone, status)` (ouverture : notification `zone_opened` + e-mail en file pour les membres du quartier), `admin_launch_mode()` / `admin_set_launch_mode(mode)` (super admin), `admin_tribes()` / `admin_save_tribe(...)`, `admin_keywords()` / `admin_save_keyword(...)`, `admin_questions()` / `admin_save_question(question, label_fr, label_en, active, options)` (libellés seulement ; une question de base reste active), `admin_zone_health(zone, from, to)` (indicateurs SPEC §15, comptes de démonstration exclus). Table `activity_days (user_id, day)` (PK, RLS sans aucun droit), alimentée par `touch_activity()`.
v1 + **[v2]** : `admin_upsert_zone(...)` avec `threshold_bads`, `threshold_women_pct`, `threshold_men_pct`, `admin_zone_health(zone_id, from, to)` (indicateurs SPEC §15), `admin_sanction` retire Bonne conduite (`revoke_good_conduct`).

### 3.5 Jobs (exécutables par `postgres` uniquement)
| Job | Fréquence | Rôle |
|---|---|---|
| `run_visit_ticks()` | **[v2-nouveau]** chaque minute (`pg_cron`) | rappels H-1 et à l'heure (notifications + `push_outbox`, idempotents) ; passage `scheduled → in_progress` à l'heure + message système « résultat du pari » ; à +10 min : `no_show` si absence (compteur du couple, 2 → classement) ; à +30 min : `ended` + `end_choice_deadline` ; décisions de fin échues (24 h) ; `choose_deadline` et `repropose_deadline` échus → classement. Puis, si `push_outbox` contient des envois dus : appel `pg_net` vers `/api/cron/push` (secret partagé). Aucun appel HTTP quand il n'y a rien à envoyer. |
| `run_promenades_due()` → `build_daily_promenade(zone_id, local_date)` | horaire | **[v2]** (remplace `run_hearings_due`) ; SQL ensembliste par lots de 500 Visiteurs, réponses en bitsets (complicité = ET + comptes de bits, arrondi exact), places données par paliers (1 Bad pour chaque Visiteur, puis un 2e… jusqu'à 5, plafond par Bad inchangé), tours avec curseur par Visiteur, `work_mem` 32 Mo pour ce job ; sans saturation, mêmes choix que la version 4a (pgTAP) ; 600 × 1 000 en 7,8 s mesuré, 5 000 × 1 000 ≈ 1 min extrapolé |
| `expire_visit_requests()` | horaire | demandes `pending` > 7 j → `auto_dismissed` |
| `compute_good_conduct()` | quotidien | **[v2]** (remplace `compute_reglo`) |
| `process_inactive_profiles()`, `auto_open_zones()`, `cleanup()`, `enqueue_*_emails()` | quotidien / horaire | `auto_open_zones` utilise `counts_for_zone` et renseigne `ready_at` |

Les purges qui touchent des fichiers ou `auth.users` passent par `/api/cron/cleanup` (clé secrète), appelée par `pg_net`.

## 4. Triggers

| Table | Trigger |
|---|---|
| `auth.users` | aucun (B4) |
| `profiles` | v1 + **[v2]** : `role` et `role_changed_at` remis à l'ancienne valeur s'ils sont modifiés hors fonction ; masquage + mots-clés sur `visit_motive` |
| `profile_tribes` | max 5 ; masquage + mots-clés |
| `photos` | max 6 ; **[v2]** un Visiteur ne peut insérer qu'en position 0 ; statut `pending` imposé |
| `casier_charges` | masquage ; mots-clés ; `casier_updated_at` ; **[v2]** insertion réservée au rôle `bad` |
| `visit_requests` | **[v2]** maintien de `pending_requests_count` / `requests_open` ; `consecutive_dismissals` |
| `conversations`, `messages` | `last_message_at`, compteurs par personne, levée du masquage (uniquement en `open`) |
| `push_subscriptions` | **[v2]** 5 maximum par membre |
| `consents`, `moderation_actions` | append-only |

## 5. Tests pgTAP prévus (extrait)

v1 (82 assertions en base, Phase 2) **+ [v2]** :
- Un membre ne peut pas modifier son `role` directement ; `change_role` refuse un second changement avant 7 jours ; Bad → Visiteur classe les demandes en attente et annule les visites ; Visiteur → Bad annule les demandes envoyées.
- Un Visiteur ne voit jamais un autre Visiteur ; un Bad ne voit jamais un autre Bad ; un Bad ne lit un Permis que s'il a reçu une demande de ce Visiteur.
- Un Bad ne peut pas envoyer de demande ; un Visiteur sans permis délivré non plus ; la 6e demande en 24 h est refusée ; une nouvelle demande avant 30 jours est refusée ; au plafond, `requests_open` passe à faux.
- **Règle 14** : ni le Visiteur ni le Bad ne lisent `guessed_index`, `casier_snapshot` ou `guess_correct` avant le début de la visite (aucune fonction, aucune table lisible, aucun canal temps réel) ; le message système de début de visite contient le chef choisi et le résultat.
- Créneaux : moins de 2 h, plus de 7 jours, 1 ou 4 créneaux, créneaux qui se chevauchent → refusés ; deux visites qui se chevauchent pour un même Bad ou un même Visiteur → refusées par la contrainte d'exclusion.
- Messages : refusés hors du créneau d'une visite tant que la conversation n'est pas passée au Permis permanent ; acceptés après le Permis permanent ; un tiers ne lit ni ne s'abonne à une visite ou une conversation qui n'est pas la sienne.
- `run_visit_ticks` (horloge simulée) : rappel envoyé une seule fois ; absence à +10 min ; deuxième absence → classement ; fin de visite ; Permis permanent seulement si les deux prolongent ; le choix de l'autre n'est jamais lisible.
- `zone_progress` : planchers de bad girls / bad boys, Bads en pause ou inactifs non comptés, `is_seed` exclus, Visiteurs non comptés.
- `push_subscriptions` : un membre ne lit que les siens ; endpoint non HTTPS refusé.
- Test générique : toute table du schéma `public` a `rowsecurity = true`.

## 6. Migration depuis la v1 en base (Phase 2b) — ✅ appliquée le 2026-10-03

Base de dev vide de membres : les renommages n'ont rien fait perdre. Trois fichiers :
1. `20261003135928_concept_v2_types.sql` : `btree_gist`, type `member_role`, enums `email_kind` (`plea_digest` → `request_digest`, + `visit_reminder`, `permit_granted`, `admin_zone_ready`) et `flag_source` (`plea` → `visit_request`, + `visit_motive`).
2. `20261003145706_concept_v2_roles_and_zones.sql` (ajouts seulement) : `profiles.role`, `role_changed_at`, `visit_motive` ; `pleas_*` → `requests_*` ; contrainte de fin d'onboarding par rôle ; triggers (masquage du Motif, une seule photo pour un Visiteur) ; `app_settings` (`promenade_max_appearances_per_day`, `zone_bad_active_days`) ; `launch_zones` (`threshold_bads`, `threshold_men_pct`, `ready_at`) ; `notification_preferences` v2 ; `set_onboarding_role()`, `complete_onboarding()` par rôle, `touch_activity()`, `counts_for_zone()`.
3. `20261003223804_concept_v2_recreate.sql` (suppressions puis recréations ; **appliquée à la main** dans l'éditeur SQL, absente de l'historique Supabase du projet de dev) : étapes 0–7, index `profiles_discovery` avec `role`, trigger `profiles_after_write` avec `visit_motive`, suppression de `threshold_profiles` et `is_complete_fiche()`, `zone_progress()` v2.

`casier_charges` n'existait pas encore : elle sera créée en Phase 3 directement avec `true_index`.
