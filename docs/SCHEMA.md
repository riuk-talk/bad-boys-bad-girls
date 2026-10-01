# Schéma de base — v1 validée (Phase 0)

> **Validé** par le porteur du projet avec les corrections de `docs/PHASE0-DECISIONS.md` §B, intégrées ci-dessous. Postgres 15+ (Supabase). Tous les horodatages en `timestamptz` (UTC).
> Les renvois **(Rxx)** pointent vers [`PHASE0.md`](./PHASE0.md) et **(Bx)** vers les corrections de [`PHASE0-DECISIONS.md`](./PHASE0-DECISIONS.md).

## 0. Principes transverses

- **RLS activée sur toutes les tables, refus par défaut.** Une table sans politique n'est lisible par personne (hors clé secrète et fonctions `security definer`).
- **Les autres membres ne lisent jamais les tables directement.** Une Fiche vue par un tiers passe toujours par une fonction `security definer` (`get_fiche`, `discover_profiles`, `get_my_hearing`…) qui applique visibilité, blocages, réciprocité, et ne renvoie que des champs publics (âge calculé, jamais la date de naissance ; jamais l'index du faux du Casier).
- **Toutes les écritures sensibles passent par des fonctions SQL** (`send_plea`, `decide_plea`, `send_message`…) ; les tables concernées n'ont **aucune** politique `insert/update/delete` pour `authenticated`.
- Fonctions `security definer` : `set search_path = ''`, noms entièrement qualifiés, `revoke execute … from public, anon` puis `grant execute … to authenticated` uniquement pour celles appelables par l'UI. Les fonctions internes (jobs) ne sont exécutables que par `postgres`.
- Extensions : `citext`, `pg_trgm`, `unaccent`, `cube` + `earthdistance` (distances), `pg_cron`, `pg_net`, `pgtap` (tests), `supabase_vault` (secrets).
- `is_seed boolean` sur les tables de contenu membre : exclusion de toutes les statistiques ; insertion impossible si le paramètre `app.env = 'production'`.
- Toutes les colonnes filtrées/triées sont indexées (listées par table).

## 1. Types énumérés

| Type | Valeurs |
|---|---|
| `gender` | `man`, `woman`, `non_binary`, `other` |
| `moderation_status` | `pending`, `approved`, `rejected` |
| `zone_status` | `waitlist`, `open` |
| `launch_mode` | `zones`, `open` |
| `importance` | `low` (1), `important` (10), `essential` (50) |
| `question_phase` | `core` (10 à l'inscription), `extra` |
| `plea_status` | `pending`, `accepted`, `dismissed`, `auto_dismissed`, `cancelled` |
| `conversation_status` | `open`, `closed` |
| `close_reason` | `dismissed`, `blocked`, `account_deleted`, `banned` |
| `venue_type` | `bar`, `cafe`, `concert`, `walk`, `activity` |
| `date_proposal_status` | `pending`, `accepted`, `countered`, `not_yet`, `cancelled` |
| `report_target` | `profile`, `photo`, `casier`, `message`, `plea` |
| `report_category` | `fake_profile`, `minor`, `harassment`, `sexual_content`, `violence_threat`, `scam`, `other` |
| `report_status` | `open`, `upheld`, `rejected` |
| `moderation_action_type` | `warn`, `suspend`, `ban`, `unban`, `hide_profile`, `unhide_profile`, `photo_approve`, `photo_reject`, `text_clear`, `text_remove`, `revoke_reglo` |
| `consent_type` | `terms`, `privacy`, `age_18`, `art9_seeking` |
| `notification_type` | `plea_received`, `plea_accepted`, `plea_dismissed`, `message_received`, `date_proposed`, `date_accepted`, `date_countered`, `hearing_open`, `moderation_decision`, `zone_opened`, `profile_dormant` |
| `email_kind` | `plea_digest`, `date_accepted`, `zone_opened`, `profile_dormant`, `weekly_digest`, `moderation_decision` |
| `flag_source` | `pseudo`, `bio`, `casier`, `tribe_detail`, `plea`, `message`, `date_venue` |

## 2. Tables

Notation RLS : **S** select, **I** insert, **U** update, **D** delete. « — » = aucune politique (donc refusé).

### 2.1 Référentiels

#### `places` — communes (seed officiel, R22)
| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `bigint` identity | PK |
| `country_code` | `char(2)` | not null, défaut `'FR'` |
| `official_code` | `text` | code INSEE ; unique (`country_code`, `official_code`) |
| `name` | `text` | not null |
| `name_search` | `text` | généré : `lower(unaccent(name))` (via fonction immuable) |
| `postal_codes` | `text[]` | |
| `lat`, `lng` | `double precision` | not null |
| `population` | `integer` | |

Index : GIN trigramme sur `name_search` (autocomplétion), GIST `ll_to_earth(lat,lng)`.
RLS : **S** `authenticated` ; I/U/D —.

#### `launch_zones`
| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `smallint` identity | PK |
| `slug` | `text` | unique |
| `name` | `text` | not null |
| `center_place_id` | `bigint` → `places` | not null |
| `radius_km` | `smallint` | check 5–200 |
| `timezone` | `text` | not null, défaut `'Europe/Paris'`, check `is_valid_timezone()` |
| `status` | `zone_status` | défaut `waitlist` |
| `threshold_profiles` | `integer` | défaut 150 |
| `threshold_women_pct` | `smallint` | défaut 40, check 0–100 |
| `auto_open` | `boolean` | défaut false |
| `opened_at` | `timestamptz` | |

RLS : **S** `authenticated` (nom, statut, seuils — la jauge est servie par `zone_progress()`) ; écriture via fonctions admin.
**(B1)** `admin_upsert_zone` recalcule `profiles.zone_id` de tous les membres dont la commune est dans l'ancien ou le nouveau périmètre (requête ensembliste unique), puis rafraîchit la jauge.

#### `app_settings` — ligne unique
`id boolean PK check (id)`, `launch_mode launch_mode default 'zones'`, `ban_hash_retention_months smallint default 12`, `email_daily_quota smallint default 300`, `email_auth_reserve smallint default 100` (part du quota réservée aux e-mails d'auth), `hearing_max_appearances_per_day smallint default 10` (R20, décision 12), `storage_alert_mb integer default 700`, `egress_alert_gb numeric default 3.5` (R1), `updated_at`.
RLS : — (lu par les fonctions ; modifié par fonction admin).

#### `tribes` — signes distinctifs
`id smallint PK`, `slug text unique`, `label jsonb not null` (`{fr, en}`, check des deux clés), `sort smallint`, `is_active boolean default true`.
RLS : **S** `authenticated` ; écriture admin via fonction.

#### `questions` / `question_options`
`questions` : `id smallint PK`, `position smallint unique`, `phase question_phase`, `label jsonb` (`{fr,en}`), `is_active boolean`, `created_at`.
`question_options` : `id smallint PK`, `question_id → questions on delete cascade`, `position smallint`, `label jsonb` ; unique (`question_id`, `position`).
RLS : **S** `authenticated` ; écriture admin via fonction.

#### `moderation_keywords`
`id int PK`, `term text not null`, `lang char(2)` (`fr`/`en`), `category report_category`, `is_active boolean`, unique (`lang`, `term`).
RLS : — (utilisé par trigger `security definer` ; géré par fonctions admin).

### 2.2 Comptes et Fiche

#### `profiles` — la Fiche (1–1 avec `auth.users`)
| Colonne | Type | Contraintes / remarque |
|---|---|---|
| `id` | `uuid` | PK, → `auth.users(id) on delete cascade` |
| `pseudo` | `citext` | unique, check longueur 3–20 ; trigger : refus e-mails/téléphones/liens |
| `birthdate` | `date` | **trigger : âge ≥ 18 ans** (`age(birthdate) >= 18`, recalculé à chaque insert/update) ; modifiable uniquement tant que l'onboarding n'est pas terminé |
| `gender` | `gender` | |
| `seeking_genders` | `gender[]` | check non vide si onboarding terminé |
| `seek_age_min`, `seek_age_max` | `smallint` | check 18 ≤ min ≤ max ≤ 99 |
| `place_id` | `bigint` → `places` | |
| `lat`, `lng` | `double precision` | copiés depuis `places` par trigger (centre de commune, jamais le GPS) |
| `zone_id` | `smallint` → `launch_zones` | calculé par trigger (R17) |
| `bio` | `varchar(500)` | masquage coordonnées + filtre mots-clés |
| `onboarding_step` | `smallint` | 0–6 |
| `onboarding_completed_at` | `timestamptz` | |
| `moderation_status` | `moderation_status` | défaut `pending` — **protégé** |
| `is_reglo` | `boolean` | **protégé** |
| `hidden_reason` | `text` | masquage auto (signalement mineur) ou admin — **protégé** |
| `suspended_until` | `timestamptz` | **protégé** |
| `banned_at` | `timestamptz` | **protégé** |
| `is_paused` | `boolean` | modifiable |
| `paused_at` | `timestamptz` | maintenu par trigger — **protégé** ; > 30 j ⇒ rotation des chemins photo (R2) |
| `pleas_cap` | `smallint` | défaut 15, check 5–50, modifiable |
| `pleas_closed_manual` | `boolean` | « Parloir complet » manuel, modifiable |
| `pending_pleas_count` | `integer` | maintenu par trigger — **protégé** |
| `pleas_open` | `boolean` | maintenu par trigger : `not pleas_closed_manual and pending_pleas_count < pleas_cap` — **protégé** |
| `last_seen_at` | `timestamptz` | mis à jour par `touch_activity()` (max 1×/heure) — **protégé** |
| `dormant_since` | `timestamptz` | inactivité 90 j — **protégé** |
| `casier_updated_at` | `timestamptz` | **protégé** (trigger) |
| `referral_code` | `text` | unique, généré — **protégé** |
| `referred_by` | `uuid` → `profiles on delete set null` | écrit une fois côté serveur — **protégé** |
| `consecutive_dismissals` | `smallint` | pour les conseils après 3 classements — **protégé** |
| `is_seed` | `boolean` | **protégé** |
| `created_at`, `updated_at` | `timestamptz` | |

Index : `pseudo` (unique), `(zone_id, moderation_status, is_paused)` partiel `where onboarding_completed_at is not null and banned_at is null and hidden_reason is null`, `gender`, `birthdate`, `last_seen_at desc`, GIST `ll_to_earth(lat,lng)`, `referral_code`.
RLS :
- **S** : propriétaire uniquement (`id = auth.uid()`).
- **I** : propriétaire (`id = auth.uid()`), colonnes protégées forcées à leur défaut par trigger.
- **U** : propriétaire, **et** privilèges de colonnes : `revoke update on profiles from authenticated; grant update (pseudo, gender, seeking_genders, seek_age_min, seek_age_max, place_id, bio, is_paused, pleas_cap, pleas_closed_manual, onboarding_step) to authenticated`. `birthdate` passe par `set_birthdate()`.
- **D** : — (suppression via la fonction serveur de suppression de compte).

#### `profile_tribes`
`profile_id → profiles on delete cascade`, `tribe_id → tribes`, `detail varchar(60)` (masquage + mots-clés), PK (`profile_id`, `tribe_id`). Trigger : 5 maximum.
RLS : **S/I/U/D** propriétaire. Lecture par les autres via `get_fiche`.

#### `photos`
| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK, défaut `gen_random_uuid()` |
| `owner_id` | `uuid` → `profiles on delete cascade` | |
| `position` | `smallint` | 0–5 (0 = photo d'identité) ; unique (`owner_id`, `position`) `deferrable initially deferred` |
| `status` | `moderation_status` | défaut `pending` |
| `pending_path` | `text` | chemin dans `photos-pending` (privé) ; null après décision |
| `public_path_large`, `public_path_small` | `text` | chemin UUID dans `photos` (public), rempli à la validation ; **renouvelé** (nouvel UUID, ancien fichier supprimé) après 30 j de pause et au bannissement (R2) |
| `width`, `height` | `smallint` | |
| `rejection_reason` | `text` | |
| `reviewed_by`, `reviewed_at` | `uuid`, `timestamptz` | |
| `created_at` | `timestamptz` | |

Index : (`status`, `created_at`) pour la file admin ; (`owner_id`, `position`).
RLS : **S** propriétaire ; **I** propriétaire, `status = 'pending'` imposé, 6 max (trigger) ; **U** — (réordonner via `reorder_photos()`) ; **D** propriétaire (trigger : suppression du fichier via file de purge).
Tailles : grande ≤ 180 Ko, vignette ≤ 30 Ko (R1). Fichiers `photos-pending` supprimés dès la décision.
Storage : `photos-pending` privé — écriture dans `{auth.uid()}/…` par le propriétaire uniquement, lecture propriétaire + admin ; `photos` public — écriture uniquement par la clé secrète (validation admin côté serveur, qui vérifie aussi l'absence d'EXIF) ; `Cache-Control: public, max-age=31536000, immutable`.

#### `casier_charges` — le Casier
| Colonne | Type | Contraintes |
|---|---|---|
| `profile_id` | `uuid` | PK → `profiles on delete cascade` |
| `charge_1`, `charge_2`, `charge_3` | `varchar(120)` | not null, masquage coordonnées |
| `false_index` | `smallint` | check 1–3 |
| `updated_at` | `timestamptz` | |

RLS : **S/I/U** propriétaire ; **D** —. Les autres voient les 3 lignes via `get_fiche` **sans** `false_index`. Trigger : filtre mots-clés → `flagged_texts`, met à jour `profiles.casier_updated_at`.

#### `answers` — réponses QCM
`user_id → profiles on delete cascade`, `question_id → questions`, `option_id → question_options` (check appartenance via trigger), `accepted_option_ids smallint[]` (null = toutes), `importance importance default 'important'`, `updated_at`. PK (`user_id`, `question_id`).
Index : (`question_id`, `user_id`).
RLS : **S/I/U/D** propriétaire. Les autres : jamais en direct (indice et points communs via fonctions, R24).

#### `consents` — historisé, jamais écrasé
`id bigint identity PK`, `user_id → profiles on delete cascade`, `type consent_type`, `text_version text not null`, `granted boolean not null`, `ip_truncated inet` (/24 en IPv4, /48 en IPv6), `created_at`.
Index : (`user_id`, `type`, `created_at desc`).
RLS : **S** propriétaire ; **I/U/D** — (insertion par le serveur avec la clé secrète, qui lit l'IP réelle ; trigger qui refuse tout `update`/`delete` hors cascade).

#### `admin_users`
`user_id uuid PK → auth.users on delete cascade`, `created_at`, `note text`.
RLS : aucune politique (ni lecture ni écriture). `is_admin()` (`security definer`) la consulte. Premier admin : `supabase/scripts/create_first_admin.sql`, exécuté à la main dans l'éditeur SQL.

#### `banned_email_hashes`
`hash bytea PK` (HMAC-SHA256, R18), `banned_at`, `expires_at`.
RLS : —. **(B4)** Contrôlée par le **hook d'authentification Supabase « Before User Created »** (disponible sur l'offre Free, vérifié le 2026-10-01 dans la doc officielle des Auth Hooks), implémenté en fonction Postgres `public.hook_before_user_created(event jsonb)` : `execute` accordé uniquement à `supabase_auth_admin`, refus avec `{"error":{"http_code":403,"message":…}}`. **Aucun trigger sur `auth.users`.** À vérifier en Phase 2 sur le projet de dev : le hook s'exécute aussi pour une inscription par lien magique (la doc ne le dit pas explicitement).

### 2.3 Interactions

#### `blocks`
`blocker_id`, `blocked_id` (→ `profiles on delete cascade`), `created_at`, PK (`blocker_id`, `blocked_id`), check `blocker_id <> blocked_id`.
Index : (`blocked_id`, `blocker_id`).
RLS : **S/D** bloqueur ; **I** — (via `block_user()` qui annule les plaidoiries et ferme la conversation de façon atomique).

#### `pleas` — plaidoiries
| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `sender_id`, `recipient_id` | `uuid` → `profiles on delete cascade` | check différents |
| `guessed_index` | `smallint` | 1–3 |
| `casier_snapshot` | `jsonb` | `{charges:[…3], false_index}` copié à l'envoi |
| `guess_correct` | `boolean` | |
| `message` | `varchar(280)` | masqué à l'insertion |
| `message_normalized` | `text` | pour l'anti-arnaque |
| `status` | `plea_status` | défaut `pending` |
| `is_crossed` | `boolean` | libération mutuelle |
| `created_at`, `decided_at` | `timestamptz` | |
| `conversation_id` | `uuid` → `conversations` | |

Index : unique partiel (`sender_id`, `recipient_id`) `where status = 'pending'` ; (`recipient_id`, `status`, `created_at`) ; (`sender_id`, `created_at desc`) (limite 24 h **et** anti-arnaque sur 7 jours, B6) ; (`status`, `created_at`) partiel `pending` (expiration). Pas d'index trigramme global (B6) : la similarité est calculée sur les seules plaidoiries du même expéditeur.
RLS : **S** expéditeur ou destinataire, et pas de blocage (le destinataire voit `casier_snapshot` ; l'expéditeur aussi — le faux est révélé après l'envoi) ; **I/U/D** —.

#### `conversations`
| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `user_a`, `user_b` | `uuid` → `profiles on delete set null` | check `user_a < user_b` à la création (R8) |
| `origin_plea_id` | `uuid` | |
| `status` | `conversation_status` | |
| `closed_by` | `uuid` | |
| `closed_reason` | `close_reason` | |
| `closed_at`, `last_message_at`, `created_at` | `timestamptz` | |
| `a_last_read_at`, `b_last_read_at` | `timestamptz` | indicateur « lu » |
| `a_message_count`, `b_message_count` | `integer` | levée du masquage à 10/10 |
| `contacts_unmasked_at` | `timestamptz` | |

Index : unique partiel (`least`, `greatest`) des deux utilisateurs `where status = 'open'` ; (`user_a`, `last_message_at desc`), (`user_b`, `last_message_at desc`).
RLS : **S** membre (`auth.uid() in (user_a, user_b)`) ; **I/U/D** — (via fonctions).

#### `messages`
`id bigint identity PK`, `conversation_id → conversations on delete cascade`, `sender_id uuid → profiles on delete set null`, `body varchar(1000)` (masqué à l'insertion tant que `contacts_unmasked_at` est null ; **mis à `null`** à la suppression du compte de l'expéditeur, R8 option stricte), `sender_deleted boolean default false`, `created_at`. Check : `body is not null or sender_deleted`.
À la suppression d'un compte, un trigger `before delete on profiles` efface le texte de ses messages (`body = null, sender_deleted = true`) avant la mise à `null` de `sender_id` ; l'UI affiche « Message supprimé ».
Index : (`conversation_id`, `id desc`) ; (`sender_id`, `created_at desc`) pour l'anti-spam.
RLS : **S** membre de la conversation **et** aucun blocage entre les deux ; **I/U/D** — (via `send_message`).
Realtime : publication `supabase_realtime` sur `messages` (Postgres Changes, la RLS s'applique à chaque abonné), abonnement filtré `conversation_id=eq.<id>`, ouvert uniquement sur la conversation affichée. **(B7)** Postgres Changes vérifie la RLS pour chaque abonné à chaque changement : acceptable au lancement ; bascule vers Realtime Broadcast (canaux privés) si les mesures de la Phase 7 le justifient.

#### `date_proposals` — la Cavale
`id uuid PK`, `conversation_id → conversations on delete cascade`, `proposer_id`, `venue_type venue_type`, `venue_name varchar(120)`, `starts_at timestamptz` (**pas** de `CHECK` avec `now()` — non immuable ; la date future est contrôlée dans `propose_date` / `respond_date`, B5), `status date_proposal_status`, `parent_id → date_proposals` (contre-proposition), `private_place_warning boolean`, `responded_at`, `created_at`.
Index : unique partiel (`conversation_id`) `where status = 'pending'` ; (`conversation_id`, `created_at desc`).
RLS : **S** membres de la conversation ; **I/U/D** — (via `propose_date`, `respond_date`).

#### `daily_hearings` — l'Audience du soir
`id bigint identity PK`, `viewer_id → profiles on delete cascade`, `profile_id → profiles on delete cascade`, `zone_id`, `hearing_date date` (date locale de la zone), `rank smallint` (1–5), `score smallint`, `visible_from timestamptz`, `visible_until timestamptz`, `seen_at timestamptz`.
Contraintes : unique (`viewer_id`, `hearing_date`, `profile_id`), unique (`viewer_id`, `hearing_date`, `rank`).
Index : (`viewer_id`, `visible_from desc`) ; (`profile_id`, `hearing_date`) (exclusion 14 jours + plafond d'apparitions).
RLS : **S** — (lecture via `get_my_hearing()` qui filtre `visible_from <= now()` et renvoie des Fiches publiques) ; **U** — (`mark_hearing_seen()`).

#### `reports` — signalements
`id uuid PK`, `reporter_id → profiles on delete set null`, `target_user_id → profiles on delete cascade`, `target_type report_target`, `target_id text`, `category report_category`, `comment varchar(500)`, `status report_status default 'open'`, `priority smallint` (mineur = 0, le plus urgent), `decision_reason text`, `decided_by uuid`, `decided_at`, `created_at`.
Index : (`status`, `priority`, `created_at`) ; unique (`reporter_id`, `target_type`, `target_id`) (pas de double signalement) ; (`target_user_id`, `category`, `status`).
RLS : **S** signaleur (ses propres signalements) ; **I** — (via `report()`).

#### `moderation_actions` — historique des décisions
`id bigint identity PK`, `admin_id uuid`, `target_user_id uuid`, `action moderation_action_type`, `reason text not null` (check non vide), `report_id uuid`, `photo_id uuid`, `expires_at`, `created_at`.
RLS : — (admin via fonctions ; la personne concernée reçoit l'exposé des motifs par notification).

#### `flagged_texts` — textes signalés par mots-clés
`id bigint identity PK`, `user_id`, `source flag_source`, `source_id text`, `excerpt text`, `matched_terms text[]`, `status report_status default 'open'`, `created_at`.
Index : (`status`, `created_at`).
RLS : — (admin via fonctions).

### 2.4 Notifications, e-mails, activité

#### `notifications`
`id bigint identity PK`, `user_id → profiles on delete cascade`, `type notification_type`, `payload jsonb`, `read_at`, `created_at`.
Index : (`user_id`, `created_at desc`) ; partiel (`user_id`) `where read_at is null`.
RLS : **S** propriétaire ; **U** — (`mark_notifications_read()`) ; **I/D** —.

#### `notification_preferences`
`user_id PK → profiles on delete cascade`, `email_plea_digest boolean default true`, `email_date_accepted default true`, `email_zone_opened default true`, `email_dormant default true`, `email_weekly default false`, `unsubscribe_token uuid unique` (lien de désinscription sans connexion).
RLS : **S/U** propriétaire.

#### `email_outbox`
`id bigint identity PK`, `user_id → profiles on delete cascade`, `kind email_kind`, `payload jsonb`, `priority smallint`, `not_before date`, `status text check in ('queued','sent','failed','skipped')`, `attempts smallint`, `sent_at`, `created_at`. Unique partiel (`user_id`, `kind`, `not_before`) `where kind = 'plea_digest'` (1 récapitulatif par jour).
#### `email_quota_usage`
`day date PK`, `sent integer`.
RLS des deux : — (route serveur avec la clé secrète).

#### `activity_days` — rétention J7/J30 (minimisation : une ligne par jour actif, rien d'autre)
`user_id → profiles on delete cascade`, `day date`, PK (`user_id`, `day`). Purge > 13 mois.
RLS : —.

## 3. Fonctions SQL

### 3.1 Utilitaires (internes ou `stable`)
| Fonction | Rôle |
|---|---|
| `is_admin()` | `exists` dans `admin_users` pour `auth.uid()` |
| `age_years(date)` | âge en années révolues |
| `normalize_text(text)` | minuscules, sans accents/ponctuation, espaces réduits |
| `mask_contacts(text)` | remplace e-mails, téléphones (formats FR/intl), URLs et `@pseudos` de réseaux par `[masqué]` ; miroir TS `lib/masking.ts` avec tests de parité |
| `flag_keywords(user, source, source_id, text)` | insère dans `flagged_texts` si un terme de `moderation_keywords` est trouvé (n'empêche jamais l'écriture) |
| `is_blocked_between(a, b)` | blocage dans un sens ou l'autre |
| `is_profile_active(p)` | onboarding terminé, photo principale validée, non banni, non suspendu, non masqué |
| `criteria_match(a, b)` | genre de B ∈ recherchés de A, âge de B dans la tranche de A, **et réciproquement** |
| `can_view_profile(viewer, target)` | actif, non bloqué, réciprocité, zone ouverte (sauf `launch_mode = open`), cible non en pause et active < 90 j |
| `has_open_relation(viewer, target)` | conversation ou plaidoirie en cours entre les deux (B2) |
| `can_unmask(conversation)` | Cavale acceptée **ou** 10/10 messages, **et** les deux comptes ont > 7 jours **et** aucun signalement `open` entre eux ni contre l'un d'eux (R7) |
| `pair_cooldown_until(a, b)` | fin du délai de 30 jours (R13/R14) |
| `touch_activity()` | met à jour `last_seen_at` et `activity_days` (appelé par le layout de l'app, 1×/h max) |

### 3.2 Appelables par l'UI (`security definer`, `authenticated`)
| Fonction | Rôle |
|---|---|
| `set_birthdate(date)` | une seule fois, avant la fin de l'onboarding ; trigger 18+ |
| `complete_onboarding()` | vérifie les 6 étapes (consentements présents, 1 photo, Casier, 10 réponses `core`) |
| `complicity_score(a, b)` → `(score smallint, common_count int, capped bool)` | §9 ; `null` si < 5 questions communes ; calcul en entiers ; plafond à 50 si un « indispensable » n'est pas satisfait ; miroir `lib/complicity.ts` |
| `common_points(a, b, n default 3)` | réponses identiques triées par importance cumulée (R29) |
| `get_fiche(target)` | autorisée si `can_view_profile` **ou** `has_open_relation` (B2 : Fiche d'un interlocuteur en pause ou inactif) ; refusée en cas de blocage dans tous les cas. Fiche publique : pseudo, âge, ville, photos validées, bio, signes + précisions, Casier sans le faux, « Casier modifié depuis » si plaidoirie en cours, indice + 3 points communs, Réglo, `pleas_open`, plaidoirie déjà en cours ou délai |
| `discover_profiles(age_min, age_max, max_km, tribe_ids, reglo_only, recently_active, cursor, limit default 24)` | §12 bis, une seule requête, curseur `(sort_key, id)` ; « Parloir complet » et inactifs 21 j en fin de liste |
| `get_my_hearing()` | sélection du jour visible (`visible_from <= now() < visible_until`), + heure de la prochaine audience |
| `mark_hearing_seen(profile_id)` | |
| `send_plea(recipient, guessed_index, message)` | toutes les règles §7 (voir 3.3) ; renvoie `{plea_id, guess_correct, crossed, conversation_id}` |
| `decide_plea(plea_id, accept boolean)` | destinataire uniquement ; libère (crée la conversation) ou classe (message prédéfini, notification) |
| `set_pleas_settings(cap, closed_manual)` | |
| `block_user(target)` / `unblock_user(target)` | atomique : annule les plaidoiries en attente, ferme la conversation (`blocked`) |
| `report(target_type, target_id, category, comment)` | crée le signalement ; signalement « mineur » : priorité 0, masquage auto si 2 signaleurs distincts ou 1 signaleur Réglo |
| `send_message(conversation_id, body)` | membre, conversation ouverte, pas de blocage, ≤ 30 messages/min, masquage tant que `can_unmask` est faux |
| `mark_conversation_read(conversation_id)` | |
| `get_counters()` | non-lus, plaidoiries en attente, notifications non lues (interrogé toutes les 60 s) |
| `propose_date(conversation_id, venue_type, venue_name, starts_at)` | une seule en attente ; détection « chez moi/chez toi »/adresse → `private_place_warning` |
| `respond_date(proposal_id, response, counter jsonb)` | accepter (lève le masquage si `can_unmask`) / contre-proposer (date future contrôlée) / pas encore |
| `close_conversation(conversation_id)` | message prédéfini, plus d'envoi, délai 30 j dans les deux sens |
| `reorder_photos(photo_ids uuid[])` | |
| `zone_progress()` | jauge de la zone du membre : Fiches complètes / seuil, % de femmes |
| `referral_count()` | « X complices recrutés » |
| `export_my_data()` → `jsonb` | périmètre R25 |
| `mark_notifications_read(ids)` | |

### 3.3 `send_plea` — ordre des contrôles (tout en une transaction, `for update` sur la ligne du destinataire)
1. Expéditeur actif, onboarding terminé, photo validée (R16), non en pause (R15), zone ouverte.
2. Destinataire visible par l'expéditeur (`can_view_profile`) et `criteria_match` réciproque ; pas de blocage.
3. Délai de 30 jours (`pair_cooldown_until`) ; pas de plaidoirie `pending` A→B (index unique).
4. Limite : 5 plaidoiries / 24 h glissantes ; 2 si le compte a moins de 24 h.
5. **Croisement** : s'il existe une plaidoirie `pending` B→A → les deux passent `accepted`, `is_crossed = true`, conversation créée, notifications « Coupables tous les deux ». (Contrôle du plafond ignoré, R9.)
6. Sinon : `pleas_open` du destinataire doit être vrai ; insertion avec copie du Casier et calcul de `guess_correct` ; trigger qui incrémente `pending_pleas_count` et recalcule `pleas_open`.
7. Anti-arnaque : parmi les plaidoiries **du même expéditeur** sur 7 jours (index `sender_id, created_at`), si ≥ 3 messages normalisés ont une similarité trigramme ≥ 0,9 (R19, B6) → signalement automatique (n'empêche pas l'envoi).
8. Notification au destinataire + mise en file du récapitulatif e-mail du jour.

### 3.4 Admin (`security definer`, contrôle `is_admin()` en première ligne)
`admin_review_photo(photo_id, approve, reason)` (la copie de fichier vers `photos` se fait côté serveur avant l'appel), `admin_decide_report(report_id, upheld, reason, action)`, `admin_sanction(user, action, reason, until)` (bannissement : insère l'empreinte e-mail, ferme les conversations, retire Réglo), `admin_resolve_flag(id, action, reason)`, `admin_upsert_zone(...)` (recalcule `zone_id` des membres concernés, B1), `admin_open_zone(zone_id)`, `admin_storage_usage()` (somme des tailles dans `storage.objects` ; l'egress n'est pas lisible en SQL, voir PROGRESS), `admin_upsert_tribe/question/keyword(...)`, `admin_search_users(q)`, `admin_zone_health(zone_id, from, to)` (indicateurs §15, `is_seed` exclus).

### 3.5 Jobs (exécutables par `postgres` uniquement)
`run_hearings_due()` → `build_daily_hearing(zone_id, local_date)`, `expire_pleas()`, `compute_reglo()`, `process_inactive_profiles()`, `auto_open_zones()`, `cleanup()`, `enqueue_*_emails()`.
Les purges qui touchent des fichiers ou `auth.users` (comptes sans onboarding terminé après 30 jours, rotation des chemins photo) passent par la route serveur `/api/cron/cleanup` (clé secrète + API Storage/Auth Admin), appelée par `pg_net`.

`build_daily_hearing` (**B3 : SQL ensembliste**, pas de boucle par paire — agrégation des réponses une seule fois par membre, jointure candidats × spectateurs pré-filtrée par zone/genre/âge, `row_number()` pour le top 5 et pour le plafond d'apparitions ; critère : 5 000 membres de seed dans une même zone en moins de 5 minutes) : pour chaque membre actif non en pause de la zone, candidats = `can_view_profile` réciproque, `pleas_open`, actifs < 21 j, aucune plaidoirie ni conversation passée entre eux, non proposés dans les 14 derniers jours, sous le plafond d'apparitions du jour (10 par défaut) ; classement = complicité (0–100, 0 si inconnue) + bonus d'activité (0–20) × 0,5 si plaidoiries en attente > 50 % du plafond (R20) ; top 5, sans remplissage.

## 4. Triggers

| Table | Trigger |
|---|---|
| `auth.users` | **aucun trigger** (B4). Empreintes bannies : hook « Before User Created ». `notification_preferences` est créée avec la Fiche à l'étape 1 de l'onboarding |
| `profiles` | `before delete` : efface le texte des messages de la personne (R8) ; `paused_at` ; âge ≥ 18 ; validation pseudo ; colonnes protégées remises à l'ancienne valeur si modifiées hors fonction ; `place_id` → `lat/lng/zone_id` ; `updated_at` ; mots-clés sur `bio`/`pseudo` |
| `profile_tribes` | max 5 ; masquage + mots-clés sur `detail` |
| `photos` | max 6 ; statut `pending` imposé à l'insertion |
| `casier_charges` | masquage ; mots-clés ; `profiles.casier_updated_at` |
| `pleas` | maintien de `pending_pleas_count` / `pleas_open` ; `consecutive_dismissals` |
| `conversations`, `messages` | `last_message_at`, compteurs par personne, levée du masquage |
| `consents`, `moderation_actions` | refus de tout `update`/`delete` (append-only) |

## 5. Tests pgTAP prévus (extrait)

- Un membre ne lit ni la Fiche brute, ni les réponses, ni le `false_index` d'un autre.
- Un membre ne peut pas modifier `moderation_status`, `is_reglo`, `banned_at`, `pleas_open`, `is_seed`… de sa propre Fiche.
- `birthdate` < 18 ans refusée en insert et en update, même via l'API.
- Aucune lecture/écriture sur `admin_users`, `banned_email_hashes`, `app_settings`, `email_outbox` depuis `authenticated` ou `anon`.
- `anon` ne lit aucune table applicative.
- Tous les critères de la Phase 4 et de la Phase 5 (6e plaidoirie refusée, 30 jours, plafond, croisement, blocage invisible partout, tiers sans accès à une conversation).
- **(B1)** Créer ou agrandir une zone rattache les membres déjà inscrits dont la commune entre dans le rayon ; la réduire les détache.
- **(B2)** La Fiche d'un interlocuteur en pause ou inactif reste lisible depuis une conversation ou une plaidoirie en cours ; jamais en cas de blocage.
- **(B4)** Une inscription normale passe le hook ; une inscription avec un e-mail banni non expiré est refusée ; une empreinte expirée ne bloque plus.
- **(R8)** Après suppression d'un compte, ses messages n'ont plus de texte en base.
- **(R7)** Pas de levée du masquage si un compte a moins de 7 jours ou si un signalement est ouvert.
- Test générique : toute table du schéma `public` a `rowsecurity = true`.
